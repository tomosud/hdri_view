// Classic TIFF decoder for exact 8/16-bit uncompressed integer samples.
// Supports both byte orders and strip-based chunky grayscale/RGB(A) images.

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  orientation: 274,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planarConfiguration: 284,
  predictor: 317,
  sampleFormat: 339
};

const TYPE_SIZE = {
  1: 1, // BYTE
  3: 2, // SHORT
  4: 4  // LONG
};

export function isTiffFile(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  return bytes.length >= 4 && (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  );
}

export function decodeTiff(source) {
  const buffer = source instanceof Uint8Array
    ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
    : source;
  const bytes = new Uint8Array(buffer);
  if (!isTiffFile(bytes)) {
    throw new Error("Not a Classic TIFF file.");
  }

  const littleEndian = bytes[0] === 0x49;
  const view = new DataView(buffer);
  const ifdOffset = view.getUint32(4, littleEndian);
  const entries = readDirectory(view, bytes.length, ifdOffset, littleEndian);
  const width = scalar(entries, TAG.width, true);
  const height = scalar(entries, TAG.height, true);
  const samplesPerPixel = scalar(entries, TAG.samplesPerPixel, false, 1);
  const bits = values(entries, TAG.bitsPerSample, true);
  const bitDepth = bits[0];
  const compression = scalar(entries, TAG.compression, false, 1);
  const photometric = scalar(entries, TAG.photometric, true);
  const planar = scalar(entries, TAG.planarConfiguration, false, 1);
  const predictor = scalar(entries, TAG.predictor, false, 1);
  const orientation = scalar(entries, TAG.orientation, false, 1);
  const sampleFormats = values(entries, TAG.sampleFormat, false, [1]);
  const stripOffsets = values(entries, TAG.stripOffsets, true);
  const stripByteCounts = values(entries, TAG.stripByteCounts, false, []);
  const rowsPerStrip = scalar(entries, TAG.rowsPerStrip, false, height);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Invalid TIFF dimensions.");
  }
  if ((bitDepth !== 8 && bitDepth !== 16) || bits.some((value) => value !== bitDepth)) {
    throw new Error(`Unsupported TIFF bit depth: ${bits.join(", ")}. Only uniform 8/16-bit samples are supported.`);
  }
  if (compression !== 1) {
    throw new Error(`Unsupported TIFF compression: ${compression}.`);
  }
  if (photometric !== 0 && photometric !== 1 && photometric !== 2) {
    throw new Error(`Unsupported TIFF photometric interpretation: ${photometric}.`);
  }
  if ((photometric === 2 && samplesPerPixel < 3) || (photometric !== 2 && samplesPerPixel < 1)) {
    throw new Error("TIFF channel count does not match its photometric interpretation.");
  }
  if (planar !== 1) {
    throw new Error("Planar TIFF is not supported; chunky/interleaved samples are required.");
  }
  if (predictor !== 1) {
    throw new Error(`Unsupported TIFF predictor: ${predictor}.`);
  }
  if (orientation !== 1) {
    throw new Error(`Unsupported TIFF orientation: ${orientation}.`);
  }
  if (sampleFormats.some((value) => value !== 1)) {
    throw new Error("Only unsigned-integer TIFF samples are supported.");
  }

  const stripCount = Math.ceil(height / rowsPerStrip);
  if (stripOffsets.length < stripCount) {
    throw new Error("TIFF strip table is incomplete.");
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > 100000000) {
    throw new Error("TIFF dimensions are too large.");
  }

  const sampleMax = bitDepth === 16 ? 65535 : 255;
  const toLinear = makeSrgbLut(sampleMax);
  const pixels = new Float32Array(pixelCount * 4);
  const bytesPerSample = bitDepth / 8;
  const sourceRowBytes = width * samplesPerPixel * bytesPerSample;

  for (let strip = 0; strip < stripCount; strip += 1) {
    const firstRow = strip * rowsPerStrip;
    const rowCount = Math.min(rowsPerStrip, height - firstRow);
    const stripOffset = stripOffsets[strip];
    const requiredBytes = rowCount * sourceRowBytes;
    const declaredBytes = stripByteCounts[strip] ?? requiredBytes;
    if (declaredBytes < requiredBytes || stripOffset < 0 || stripOffset + requiredBytes > bytes.length) {
      throw new Error(`TIFF strip ${strip + 1} is truncated.`);
    }

    for (let localRow = 0; localRow < rowCount; localRow += 1) {
      let sourceOffset = stripOffset + localRow * sourceRowBytes;
      let targetOffset = (firstRow + localRow) * width * 4;
      for (let x = 0; x < width; x += 1) {
        const first = readSample(view, bytes, sourceOffset, bitDepth, littleEndian);
        if (photometric === 2) {
          const green = readSample(view, bytes, sourceOffset + bytesPerSample, bitDepth, littleEndian);
          const blue = readSample(view, bytes, sourceOffset + bytesPerSample * 2, bitDepth, littleEndian);
          pixels[targetOffset] = toLinear[first];
          pixels[targetOffset + 1] = toLinear[green];
          pixels[targetOffset + 2] = toLinear[blue];
        } else {
          const gray = photometric === 0 ? sampleMax - first : first;
          const linear = toLinear[gray];
          pixels[targetOffset] = linear;
          pixels[targetOffset + 1] = linear;
          pixels[targetOffset + 2] = linear;
        }
        const alphaSample = samplesPerPixel === 2 && photometric !== 2
          ? readSample(view, bytes, sourceOffset + bytesPerSample, bitDepth, littleEndian)
          : samplesPerPixel >= 4 && photometric === 2
            ? readSample(view, bytes, sourceOffset + bytesPerSample * 3, bitDepth, littleEndian)
            : sampleMax;
        pixels[targetOffset + 3] = alphaSample / sampleMax;
        sourceOffset += samplesPerPixel * bytesPerSample;
        targetOffset += 4;
      }
    }
  }

  return {
    width,
    height,
    pixels,
    bitDepth,
    channels: photometric === 2 ? (samplesPerPixel >= 4 ? "rgba" : "rgb") : (samplesPerPixel >= 2 ? "gray-alpha" : "gray")
  };
}

function readDirectory(view, byteLength, offset, littleEndian) {
  ensureRange(offset, 2, byteLength);
  const count = view.getUint16(offset, littleEndian);
  ensureRange(offset + 2, count * 12 + 4, byteLength);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const entryOffset = offset + 2 + index * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const valueCount = view.getUint32(entryOffset + 4, littleEndian);
    const typeSize = TYPE_SIZE[type];
    if (!typeSize || valueCount > 1000000) {
      continue;
    }
    const byteCount = typeSize * valueCount;
    const valueOffset = byteCount <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian);
    ensureRange(valueOffset, byteCount, byteLength);
    const entryValues = [];
    for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
      const itemOffset = valueOffset + valueIndex * typeSize;
      entryValues.push(type === 1
        ? view.getUint8(itemOffset)
        : type === 3
          ? view.getUint16(itemOffset, littleEndian)
          : view.getUint32(itemOffset, littleEndian));
    }
    entries.set(tag, entryValues);
  }
  return entries;
}

function values(entries, tag, required, fallback = []) {
  const result = entries.get(tag);
  if (!result && required) {
    throw new Error(`Required TIFF tag ${tag} is missing.`);
  }
  return result || fallback;
}

function scalar(entries, tag, required, fallback = null) {
  return values(entries, tag, required, fallback === null ? [] : [fallback])[0];
}

function ensureRange(offset, size, byteLength) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > byteLength) {
    throw new Error("Invalid or truncated TIFF directory.");
  }
}

function readSample(view, bytes, offset, bitDepth, littleEndian) {
  return bitDepth === 16 ? view.getUint16(offset, littleEndian) : bytes[offset];
}

function makeSrgbLut(max) {
  const lut = new Float32Array(max + 1);
  for (let sample = 0; sample <= max; sample += 1) {
    const encoded = sample / max;
    lut[sample] = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
  }
  return lut;
}
