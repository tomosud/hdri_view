/* global GeoTIFF, importScripts */

importScripts("./vendor/geotiff/geotiff.js?v=3.0.5");

const PHOTOMETRIC_WHITE_IS_ZERO = 0;
const PHOTOMETRIC_BLACK_IS_ZERO = 1;
const PHOTOMETRIC_RGB = 2;
const SAMPLE_UNSIGNED = 1;
const SAMPLE_SIGNED = 2;
const SAMPLE_FLOAT = 3;

self.addEventListener("message", async (event) => {
  const message = event.data || {};
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
