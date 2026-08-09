/* global GeoTIFF, importScripts */

importScripts("./vendor/geotiff/geotiff.js?v=3.0.5");

const PHOTOMETRIC_WHITE_IS_ZERO = 0;
const PHOTOMETRIC_BLACK_IS_ZERO = 1;
const PHOTOMETRIC_RGB = 2;
const SAMPLE_UNSIGNED = 1;
const SAMPLE_SIGNED = 2;
const SAMPLE_FLOAT = 3;

let rasterImage = null;
let rasterInfo = null;

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type === "raster-init") {
    await initializeRasterSource(message);
    return;
  }
  if (message.type === "raster-request") {
    await handleRasterRequest(message);
    return;
  }
  if (message.type === "raster-dispose") {
    rasterImage = null;
    rasterInfo = null;
    self.close();
    return;
  }
  if (message.type !== "decode") {
    return;
  }
  try {
    self.postMessage({ type: "progress", progress: 0, label: "Starting TIFF decode" });
    const tiff = await GeoTIFF.fromArrayBuffer(message.buffer);
    const image = await tiff.getImage();
    const directory = image.getFileDirectory();
    const sourceWidth = image.getWidth();
    const sourceHeight = image.getHeight();
    const samplesPerPixel = image.getSamplesPerPixel();
    const bits = Array.from({ length: samplesPerPixel }, (_, index) => image.getBitsPerSample(index));
    const sampleFormats = Array.from({ length: samplesPerPixel }, (_, index) => image.getSampleFormat(index));
    const photometric = directory.getValue("PhotometricInterpretation");
    const orientation = directory.getValue("Orientation") || 1;
    const compression = directory.getValue("Compression") || 1;
    if (sourceWidth < 1 || sourceHeight < 1 || samplesPerPixel < 1) {
      throw new Error("Invalid TIFF dimensions or sample count.");
    }
    if (orientation < 1 || orientation > 8) {
      throw new Error(`Unsupported TIFF orientation: ${orientation}.`);
    }
    if (bits.some((value) => !Number.isInteger(value) || value < 1 || value > 32)) {
      throw new Error(`Unsupported TIFF bit depth: ${bits.join(", ")}.`);
    }
    if (sampleFormats.some((value) => ![SAMPLE_UNSIGNED, SAMPLE_SIGNED, SAMPLE_FLOAT].includes(value))) {
      throw new Error(`Unsupported TIFF sample format: ${sampleFormats.join(", ")}.`);
    }

    let raw;
    let channels;
    let convertedRgb = false;
    if (photometric === PHOTOMETRIC_RGB || photometric === PHOTOMETRIC_BLACK_IS_ZERO || photometric === PHOTOMETRIC_WHITE_IS_ZERO) {
      raw = await image.readRasters({ interleave: true });
      channels = photometric === PHOTOMETRIC_RGB
        ? (samplesPerPixel >= 4 ? "rgba" : "rgb")
        : (samplesPerPixel >= 2 ? "gray-alpha" : "gray");
    } else {
      raw = await image.readRGB({ interleave: true });
      channels = "rgb";
      convertedRgb = true;
    }

    const rotated = orientation >= 5;
    const width = rotated ? sourceHeight : sourceWidth;
    const height = rotated ? sourceWidth : sourceHeight;
    const pixels = new Float32Array(width * height * 4);
    const sourceChannels = convertedRgb ? 3 : samplesPerPixel;

    for (let y = 0; y < sourceHeight; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        const source = (y * sourceWidth + x) * sourceChannels;
        const [targetX, targetY] = orientedPosition(x, y, sourceWidth, sourceHeight, orientation);
        const target = (targetY * width + targetX) * 4;
        if (convertedRgb) {
          pixels[target] = srgbToLinear(raw[source] / 255);
          pixels[target + 1] = srgbToLinear(raw[source + 1] / 255);
          pixels[target + 2] = srgbToLinear(raw[source + 2] / 255);
          pixels[target + 3] = 1;
          continue;
        }

        if (photometric === PHOTOMETRIC_RGB) {
          pixels[target] = colorValue(raw[source], bits[0], sampleFormats[0]);
          pixels[target + 1] = colorValue(raw[source + 1], bits[1], sampleFormats[1]);
          pixels[target + 2] = colorValue(raw[source + 2], bits[2], sampleFormats[2]);
          pixels[target + 3] = samplesPerPixel >= 4
            ? alphaValue(raw[source + 3], bits[3], sampleFormats[3])
            : 1;
        } else {
          let encoded = normalizedValue(raw[source], bits[0], sampleFormats[0]);
          if (photometric === PHOTOMETRIC_WHITE_IS_ZERO) {
            encoded = 1 - encoded;
          }
          const gray = sampleFormats[0] === SAMPLE_FLOAT ? encoded : srgbToLinear(encoded);
          pixels[target] = gray;
          pixels[target + 1] = gray;
          pixels[target + 2] = gray;
          pixels[target + 3] = samplesPerPixel >= 2
            ? alphaValue(raw[source + 1], bits[1], sampleFormats[1])
            : 1;
        }
      }
    }

    const uniqueBits = [...new Set(bits)];
    const uniqueFormats = [...new Set(sampleFormats)];
    const bitDepth = Math.max(...bits);
    const bitDepthLabel = convertedRgb
      ? `${uniqueBits.join("/")}-bit→RGB8`
      : uniqueFormats.length === 1 && uniqueFormats[0] === SAMPLE_FLOAT
        ? `${uniqueBits.join("/")}F`
        : `${uniqueBits.join("/")}-bit`;
    self.postMessage({
      type: "result",
      width,
      height,
      pixels: pixels.buffer,
      bitDepth,
      bitDepthLabel,
      channels,
      compression,
      sampleFormat: uniqueFormats.length === 1 ? uniqueFormats[0] : 0
    }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
});

async function initializeRasterSource(message) {
  try {
    const tiff = message.file
      ? await GeoTIFF.fromBlob(message.file)
      : await GeoTIFF.fromArrayBuffer(message.buffer);
    const image = await tiff.getImage();
    const directory = image.getFileDirectory();
    const width = image.getWidth();
    const height = image.getHeight();
    const samplesPerPixel = image.getSamplesPerPixel();
    const bits = Array.from({ length: samplesPerPixel }, (_, index) => image.getBitsPerSample(index));
    const sampleFormats = Array.from({ length: samplesPerPixel }, (_, index) => image.getSampleFormat(index));
    const photometric = directory.getValue("PhotometricInterpretation");
    const orientation = directory.getValue("Orientation") || 1;
    const compression = directory.getValue("Compression") || 1;
    if (orientation !== 1) {
      throw new Error(`TIFF tiled source currently requires Orientation 1 (found ${orientation}).`);
    }
    if (bits.some((value) => !Number.isInteger(value) || value < 1 || value > 32)) {
      throw new Error(`Unsupported TIFF bit depth: ${bits.join(", ")}.`);
    }
    if (sampleFormats.some((value) => ![SAMPLE_UNSIGNED, SAMPLE_SIGNED, SAMPLE_FLOAT].includes(value))) {
      throw new Error(`Unsupported TIFF sample format: ${sampleFormats.join(", ")}.`);
    }
    const convertedRgb = ![PHOTOMETRIC_RGB, PHOTOMETRIC_BLACK_IS_ZERO, PHOTOMETRIC_WHITE_IS_ZERO].includes(photometric);
    const channels = convertedRgb
      ? "rgb"
      : photometric === PHOTOMETRIC_RGB
        ? (samplesPerPixel >= 4 ? "rgba" : "rgb")
        : (samplesPerPixel >= 2 ? "gray-alpha" : "gray");
    const uniqueBits = [...new Set(bits)];
    const uniqueFormats = [...new Set(sampleFormats)];
    const bitDepthLabel = convertedRgb
      ? `${uniqueBits.join("/")}-bit→RGB8`
      : uniqueFormats.length === 1 && uniqueFormats[0] === SAMPLE_FLOAT
        ? `${uniqueBits.join("/")}F`
        : `${uniqueBits.join("/")}-bit`;
    rasterImage = image;
    rasterInfo = {
      width,
      height,
      samplesPerPixel,
      bits,
      sampleFormats,
      photometric,
      convertedRgb,
      channels,
      compression,
      bitDepth: Math.max(...bits),
      bitDepthLabel,
      sampleFormat: uniqueFormats.length === 1 ? uniqueFormats[0] : 0
    };
    const preview = await readRasterPreview(1024);
    self.postMessage({
      id: message.id,
      type: "raster-ready",
      result: {
        ...rasterInfo,
        previewWidth: preview.width,
        previewHeight: preview.height,
        previewPixels: preview.pixels.buffer
      }
    }, [preview.pixels.buffer]);
  } catch (error) {
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
}

async function handleRasterRequest(message) {
  if (!rasterImage || !rasterInfo) {
    self.postMessage({ id: message.id, type: "error", message: "TIFF raster source is not initialized." });
    return;
  }
  try {
    let result;
    if (message.operation === "tile") {
      result = await readRasterTile(message);
    } else if (message.operation === "region") {
      const rect = message.rect;
      const pixels = await readLinearWindow([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height], rect.width, rect.height);
      result = { width: rect.width, height: rect.height, pixels: pixels.buffer };
    } else if (message.operation === "preview") {
      const preview = await readRasterPreview(message.maximumEdge || 1024);
      result = { width: preview.width, height: preview.height, pixels: preview.pixels.buffer };
    } else {
      throw new Error(`Unknown TIFF raster operation: ${message.operation}.`);
    }
    self.postMessage({ id: message.id, type: "result", result }, [result.pixels]);
  } catch (error) {
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
}

async function readRasterPreview(maximumEdge) {
  const scale = Math.min(1, maximumEdge / Math.max(rasterInfo.width, rasterInfo.height));
  const width = Math.max(1, Math.round(rasterInfo.width * scale));
  const height = Math.max(1, Math.round(rasterInfo.height * scale));
  const pixels = await readLinearWindow([0, 0, rasterInfo.width, rasterInfo.height], width, height);
  return { width, height, pixels };
}

async function readRasterTile({ level, tileX, tileY, gutter = 1 }) {
  const tileSize = 512;
  const factor = 2 ** level;
  const levelWidth = Math.ceil(rasterInfo.width / factor);
  const levelHeight = Math.ceil(rasterInfo.height / factor);
  const levelX = tileX * tileSize;
  const levelY = tileY * tileSize;
  const width = Math.min(tileSize, levelWidth - levelX);
  const height = Math.min(tileSize, levelHeight - levelY);
  if (width < 1 || height < 1) throw new Error("TIFF tile is outside the image.");
  const sourceX = levelX * factor;
  const sourceY = levelY * factor;
  const sourceRight = Math.min(rasterInfo.width, sourceX + width * factor);
  const sourceBottom = Math.min(rasterInfo.height, sourceY + height * factor);
  const interior = await readLinearWindow([sourceX, sourceY, sourceRight, sourceBottom], width, height);
  const stride = width + gutter * 2;
  const pixels = new Float32Array(stride * (height + gutter * 2) * 4);
  for (let y = -gutter; y < height + gutter; y += 1) {
    const sampleY = Math.max(0, Math.min(height - 1, y));
    for (let x = -gutter; x < width + gutter; x += 1) {
      const sampleX = Math.max(0, Math.min(width - 1, x));
      const source = (sampleY * width + sampleX) * 4;
      const target = ((y + gutter) * stride + x + gutter) * 4;
      pixels.set(interior.subarray(source, source + 4), target);
    }
  }
  return { level, tileX, tileY, gutter, width, height, stride, pixels: pixels.buffer };
}

async function readLinearWindow(window, width, height) {
  const options = { window, width, height, interleave: true, resampleMethod: "bilinear" };
  let raw;
  let sourceChannels;
  if (rasterInfo.convertedRgb) {
    raw = await rasterImage.readRGB(options);
    sourceChannels = 3;
  } else {
    raw = await rasterImage.readRasters(options);
    sourceChannels = rasterInfo.samplesPerPixel;
  }
  const pixels = new Float32Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * sourceChannels;
    const target = pixel * 4;
    if (rasterInfo.convertedRgb) {
      pixels[target] = srgbToLinear(raw[source] / 255);
      pixels[target + 1] = srgbToLinear(raw[source + 1] / 255);
      pixels[target + 2] = srgbToLinear(raw[source + 2] / 255);
      pixels[target + 3] = 1;
    } else if (rasterInfo.photometric === PHOTOMETRIC_RGB) {
      pixels[target] = colorValue(raw[source], rasterInfo.bits[0], rasterInfo.sampleFormats[0]);
      pixels[target + 1] = colorValue(raw[source + 1], rasterInfo.bits[1], rasterInfo.sampleFormats[1]);
      pixels[target + 2] = colorValue(raw[source + 2], rasterInfo.bits[2], rasterInfo.sampleFormats[2]);
      pixels[target + 3] = sourceChannels >= 4
        ? alphaValue(raw[source + 3], rasterInfo.bits[3], rasterInfo.sampleFormats[3])
        : 1;
    } else {
      let encoded = normalizedValue(raw[source], rasterInfo.bits[0], rasterInfo.sampleFormats[0]);
      if (rasterInfo.photometric === PHOTOMETRIC_WHITE_IS_ZERO) encoded = 1 - encoded;
      const gray = rasterInfo.sampleFormats[0] === SAMPLE_FLOAT ? encoded : srgbToLinear(encoded);
      pixels[target] = gray;
      pixels[target + 1] = gray;
      pixels[target + 2] = gray;
      pixels[target + 3] = sourceChannels >= 2
        ? alphaValue(raw[source + 1], rasterInfo.bits[1], rasterInfo.sampleFormats[1])
        : 1;
    }
  }
  return pixels;
}

function normalizedValue(value, bits, sampleFormat) {
  if (sampleFormat === SAMPLE_FLOAT) {
    return value;
  }
  if (sampleFormat === SAMPLE_SIGNED) {
    const minimum = -(2 ** (bits - 1));
    return (value - minimum) / (2 ** bits - 1);
  }
  return value / (2 ** bits - 1);
}

function colorValue(value, bits, sampleFormat) {
  const normalized = normalizedValue(value, bits, sampleFormat);
  return sampleFormat === SAMPLE_FLOAT ? normalized : srgbToLinear(normalized);
}

function alphaValue(value, bits, sampleFormat) {
  return Math.max(0, Math.min(1, normalizedValue(value, bits, sampleFormat)));
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function orientedPosition(x, y, width, height, orientation) {
  switch (orientation) {
    case 2: return [width - 1 - x, y];
    case 3: return [width - 1 - x, height - 1 - y];
    case 4: return [x, height - 1 - y];
    case 5: return [y, x];
    case 6: return [height - 1 - y, x];
    case 7: return [height - 1 - y, width - 1 - x];
    case 8: return [y, width - 1 - x];
    default: return [x, y];
  }
}
