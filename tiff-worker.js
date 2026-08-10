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
let directRasterReader = null;

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
    directRasterReader = null;
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
    directRasterReader = await createDirectUncompressedStripReader(message.file, directory, {
      width,
      height,
      samplesPerPixel,
      bits,
      sampleFormats,
      photometric,
      convertedRgb,
      compression
    });
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
      sampleFormat: uniqueFormats.length === 1 ? uniqueFormats[0] : 0,
      accessMode: directRasterReader ? "direct-uncompressed-strips" : "geotiff"
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
  if (directRasterReader) {
    return readDirectUncompressedWindow(window, width, height);
  }
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

async function createDirectUncompressedStripReader(file, directory, info) {
  if (!(file instanceof Blob) || info.compression !== 1 || info.convertedRgb) return null;
  const planarConfiguration = directory.getValue("PlanarConfiguration") || 1;
  const predictor = directory.getValue("Predictor") || 1;
  const fillOrder = directory.getValue("FillOrder") || 1;
  const stripOffsets = numericTagArray(directory.getValue("StripOffsets"));
  const stripByteCounts = numericTagArray(directory.getValue("StripByteCounts"));
  const rowsPerStrip = Number(directory.getValue("RowsPerStrip") || info.height);
  if (
    planarConfiguration !== 1 || predictor !== 1 || fillOrder !== 1 ||
    stripOffsets.length < 1 || stripOffsets.length !== stripByteCounts.length ||
    !Number.isInteger(rowsPerStrip) || rowsPerStrip < 1 ||
    info.bits.some((bits, channel) => (
      ![8, 16, 32].includes(bits) ||
      (info.sampleFormats[channel] === SAMPLE_FLOAT && bits !== 32)
    ))
  ) {
    return null;
  }

  const sampleByteOffsets = [];
  let pixelBytes = 0;
  for (const bits of info.bits) {
    sampleByteOffsets.push(pixelBytes);
    pixelBytes += bits / 8;
  }
  const rowBytes = info.width * pixelBytes;
  const stripCount = Math.ceil(info.height / rowsPerStrip);
  if (!Number.isSafeInteger(rowBytes) || stripOffsets.length < stripCount) return null;
  for (let strip = 0; strip < stripCount; strip += 1) {
    const offset = stripOffsets[strip];
    const byteCount = stripByteCounts[strip];
    const rowCount = Math.min(rowsPerStrip, info.height - strip * rowsPerStrip);
    const requiredBytes = rowCount * rowBytes;
    if (
      !Number.isSafeInteger(offset) || !Number.isSafeInteger(byteCount) ||
      offset < 0 || byteCount < requiredBytes || offset + requiredBytes > file.size
    ) {
      return null;
    }
  }

  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const littleEndian = signature[0] === 0x49 && signature[1] === 0x49;
  const bigEndian = signature[0] === 0x4d && signature[1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  return {
    file,
    ...info,
    rowsPerStrip,
    stripOffsets,
    stripByteCounts,
    sampleByteOffsets,
    pixelBytes,
    rowBytes,
    littleEndian
  };
}

function numericTagArray(value) {
  const values = value == null
    ? []
    : Array.isArray(value) || ArrayBuffer.isView(value)
      ? Array.from(value)
      : [value];
  return values.map((entry) => Number(entry));
}

async function readDirectUncompressedWindow(window, width, height) {
  const reader = directRasterReader;
  const left = Math.max(0, Math.min(reader.width - 1, Math.floor(window[0])));
  const top = Math.max(0, Math.min(reader.height - 1, Math.floor(window[1])));
  const right = Math.max(left + 1, Math.min(reader.width, Math.ceil(window[2])));
  const bottom = Math.max(top + 1, Math.min(reader.height, Math.ceil(window[3])));
  const outputWidth = Math.max(1, Math.floor(width));
  const outputHeight = Math.max(1, Math.floor(height));
  const xSamples = directSampleCoordinates(left, right, outputWidth);
  const ySamples = directSampleCoordinates(top, bottom, outputHeight);
  const sourceXStart = xSamples.reduce((minimum, sample) => Math.min(minimum, sample.low), right - 1);
  const sourceXEnd = xSamples.reduce((maximum, sample) => Math.max(maximum, sample.high + 1), left + 1);
  const neededRows = [...new Set(ySamples.flatMap((sample) => [sample.low, sample.high]))].sort((a, b) => a - b);
  const rows = await readDirectRowSegments(reader, neededRows, sourceXStart, sourceXEnd);
  const pixels = new Float32Array(outputWidth * outputHeight * 4);
  const topLeft = new Float32Array(4);
  const topRight = new Float32Array(4);
  const bottomLeft = new Float32Array(4);
  const bottomRight = new Float32Array(4);

  for (let y = 0; y < outputHeight; y += 1) {
    const sampleY = ySamples[y];
    const topRow = rows.get(sampleY.low);
    const bottomRow = rows.get(sampleY.high);
    for (let x = 0; x < outputWidth; x += 1) {
      const sampleX = xSamples[x];
      const target = (y * outputWidth + x) * 4;
      if (sampleX.low === sampleX.high && sampleY.low === sampleY.high) {
        readDirectLinearPixel(reader, topRow, sampleX.low - sourceXStart, topLeft);
        pixels[target] = topLeft[0];
        pixels[target + 1] = topLeft[1];
        pixels[target + 2] = topLeft[2];
        pixels[target + 3] = topLeft[3];
        continue;
      }
      readDirectLinearPixel(reader, topRow, sampleX.low - sourceXStart, topLeft);
      readDirectLinearPixel(reader, topRow, sampleX.high - sourceXStart, topRight);
      readDirectLinearPixel(reader, bottomRow, sampleX.low - sourceXStart, bottomLeft);
      readDirectLinearPixel(reader, bottomRow, sampleX.high - sourceXStart, bottomRight);
      for (let channel = 0; channel < 4; channel += 1) {
        const upper = topLeft[channel] + (topRight[channel] - topLeft[channel]) * sampleX.fraction;
        const lower = bottomLeft[channel] + (bottomRight[channel] - bottomLeft[channel]) * sampleX.fraction;
        pixels[target + channel] = upper + (lower - upper) * sampleY.fraction;
      }
    }
  }
  return pixels;
}

function directSampleCoordinates(start, end, outputSize) {
  const span = end - start;
  if (span === outputSize) {
    return Array.from({ length: outputSize }, (_, index) => ({
      low: start + index,
      high: start + index,
      fraction: 0
    }));
  }
  return Array.from({ length: outputSize }, (_, index) => {
    const position = Math.max(start, Math.min(end - 1, start + (index + 0.5) * span / outputSize - 0.5));
    const low = Math.floor(position);
    const high = Math.min(end - 1, low + 1);
    return { low, high, fraction: position - low };
  });
}

async function readDirectRowSegments(reader, rowNumbers, sourceXStart, sourceXEnd) {
  const rows = new Map();
  const segmentBytes = (sourceXEnd - sourceXStart) * reader.pixelBytes;
  const concurrency = 32;
  for (let start = 0; start < rowNumbers.length; start += concurrency) {
    const batch = rowNumbers.slice(start, start + concurrency);
    const resolved = await Promise.all(batch.map(async (rowNumber) => {
      const strip = Math.floor(rowNumber / reader.rowsPerStrip);
      const rowWithinStrip = rowNumber - strip * reader.rowsPerStrip;
      const offset = reader.stripOffsets[strip] + rowWithinStrip * reader.rowBytes + sourceXStart * reader.pixelBytes;
      const stripEnd = reader.stripOffsets[strip] + reader.stripByteCounts[strip];
      if (offset < reader.stripOffsets[strip] || offset + segmentBytes > stripEnd) {
        throw new Error(`TIFF row ${rowNumber} exceeds its strip byte range.`);
      }
      const buffer = await reader.file.slice(offset, offset + segmentBytes).arrayBuffer();
      if (buffer.byteLength !== segmentBytes) {
        throw new Error(`TIFF row ${rowNumber} could not be read completely.`);
      }
      return [rowNumber, { bytes: new Uint8Array(buffer), view: new DataView(buffer) }];
    }));
    for (const [rowNumber, row] of resolved) rows.set(rowNumber, row);
  }
  return rows;
}

function readDirectLinearPixel(reader, row, localX, target) {
  const pixelOffset = localX * reader.pixelBytes;
  if (reader.photometric === PHOTOMETRIC_RGB) {
    const red = readDirectChannel(reader, row, pixelOffset, 0);
    const green = readDirectChannel(reader, row, pixelOffset, 1);
    const blue = readDirectChannel(reader, row, pixelOffset, 2);
    target[0] = colorValue(red, reader.bits[0], reader.sampleFormats[0]);
    target[1] = colorValue(green, reader.bits[1], reader.sampleFormats[1]);
    target[2] = colorValue(blue, reader.bits[2], reader.sampleFormats[2]);
    if (reader.samplesPerPixel >= 4) {
      const alpha = readDirectChannel(reader, row, pixelOffset, 3);
      target[3] = alphaValue(alpha, reader.bits[3], reader.sampleFormats[3]);
    } else {
      target[3] = 1;
    }
    return;
  }
  const graySample = readDirectChannel(reader, row, pixelOffset, 0);
  let encoded = normalizedValue(graySample, reader.bits[0], reader.sampleFormats[0]);
  if (reader.photometric === PHOTOMETRIC_WHITE_IS_ZERO) encoded = 1 - encoded;
  const gray = reader.sampleFormats[0] === SAMPLE_FLOAT ? encoded : srgbToLinear(encoded);
  target[0] = gray;
  target[1] = gray;
  target[2] = gray;
  if (reader.samplesPerPixel >= 2) {
    const alpha = readDirectChannel(reader, row, pixelOffset, 1);
    target[3] = alphaValue(alpha, reader.bits[1], reader.sampleFormats[1]);
  } else {
    target[3] = 1;
  }
}

function readDirectChannel(reader, row, pixelOffset, channel) {
  return readDirectSample(
    reader,
    row,
    pixelOffset + reader.sampleByteOffsets[channel],
    reader.bits[channel],
    reader.sampleFormats[channel]
  );
}

function readDirectSample(reader, row, offset, bits, sampleFormat) {
  if (bits === 8) {
    return sampleFormat === SAMPLE_SIGNED ? row.view.getInt8(offset) : row.bytes[offset];
  }
  if (bits === 16) {
    return sampleFormat === SAMPLE_SIGNED
      ? row.view.getInt16(offset, reader.littleEndian)
      : row.view.getUint16(offset, reader.littleEndian);
  }
  if (sampleFormat === SAMPLE_FLOAT) return row.view.getFloat32(offset, reader.littleEndian);
  return sampleFormat === SAMPLE_SIGNED
    ? row.view.getInt32(offset, reader.littleEndian)
    : row.view.getUint32(offset, reader.littleEndian);
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
