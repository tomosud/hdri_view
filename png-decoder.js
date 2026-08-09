// PNG を自前でデコードして、ファイルに格納された値をそのまま取り出すためのモジュール。
//
// Canvas 2D 経由（createImageBitmap → drawImage → getImageData）だと
//   - バッキングストアが premultiplied alpha のため、alpha < 255 の画素で RGB が量子化される
//   - getImageData が 8bit 固定なので 16bit PNG の下位ビットが落ちる
// という 2 つの非可逆変換が入る。値を計測するツールとしては困るので、
// IDAT を DecompressionStream("deflate") で展開して自前で組み立てる。
//
// 外部ライブラリは使わない（ブラウザ内蔵 API のみ）。

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Adam7 インタレースの各パスの開始位置と間隔
const ADAM7_X_ORIGIN = [0, 4, 0, 2, 0, 1, 0];
const ADAM7_Y_ORIGIN = [0, 0, 4, 0, 2, 0, 1];
const ADAM7_X_STEP = [8, 8, 4, 4, 2, 2, 1];
const ADAM7_Y_STEP = [8, 8, 8, 4, 4, 2, 2];

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

export function isPngFile(bytes) {
  if (!bytes || bytes.length < SIGNATURE.length) {
    return false;
  }
  return SIGNATURE.every((value, index) => bytes[index] === value);
}

/**
 * PNG をデコードして 0..1 に正規化した RGBA を返す。
 * 値はファイルに書かれたまま（＝符号化されたまま）で、線形化はしていない。
 *
 * @param {ArrayBuffer|Uint8Array} source
 * @param {{maxPixels?: number}} options
 * @returns {Promise<{
 *   width: number, height: number, data: Float32Array,
 *   bitDepth: number, colorType: number, interlace: number,
 *   hasAlpha: boolean, gamma: number|null, srgbIntent: number|null, hasIccProfile: boolean
 * }>}
 */
export async function decodePng(source, { maxPixels = Number.POSITIVE_INFINITY } = {}) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (!isPngFile(bytes)) {
    throw new Error("Not a PNG file.");
  }

  const chunks = readChunks(bytes);
  const header = parseHeader(chunks.header);
  const { width, height, bitDepth, colorType, interlace } = header;

  if (width * height > maxPixels) {
    if (interlace !== 0 || ![8, 16].includes(bitDepth) || ![0, 2, 4, 6].includes(colorType)) {
      const error = new Error("Huge PNG preview supports non-interlaced 8/16-bit Gray, Gray+Alpha, RGB, and RGBA data.");
      error.code = "PNG_HUGE_UNSUPPORTED";
      throw error;
    }
    return decodeLargePngPreview(chunks, header, maxPixels);
  }

  const samplesPerPixel = samplesForColorType(colorType);
  const bitsPerPixel = samplesPerPixel * bitDepth;
  // フィルタ計算に使う「1画素分のバイト数」は仕様上 1 バイト未満でも 1 に切り上げる
  const filterStride = Math.max(1, bitsPerPixel >> 3);

  const inflated = await inflate(concatChunks(chunks.idat));
  const output = new Float32Array(width * height * 4);

  const context = {
    bitDepth,
    colorType,
    samplesPerPixel,
    maxValue: (1 << bitDepth) - 1,
    palette: chunks.palette,
    paletteAlpha: chunks.paletteAlpha,
    transparent: chunks.transparent,
    output,
    outputWidth: width
  };

  if (interlace === 0) {
    const bytesPerLine = Math.ceil((width * bitsPerPixel) / 8);
    const expected = height * (bytesPerLine + 1);
    if (inflated.length < expected) {
      throw new Error(`PNG data is truncated (expected ${expected} bytes, got ${inflated.length}).`);
    }
    const lines = unfilter(inflated, 0, height, bytesPerLine, filterStride);
    writePass(context, lines, bytesPerLine, width, height, 0, 0, 1, 1);
  } else if (interlace === 1) {
    let offset = 0;
    for (let pass = 0; pass < 7; pass += 1) {
      const passWidth = Math.ceil((width - ADAM7_X_ORIGIN[pass]) / ADAM7_X_STEP[pass]);
      const passHeight = Math.ceil((height - ADAM7_Y_ORIGIN[pass]) / ADAM7_Y_STEP[pass]);
      if (passWidth <= 0 || passHeight <= 0) {
        continue;
      }
      const bytesPerLine = Math.ceil((passWidth * bitsPerPixel) / 8);
      const consumed = passHeight * (bytesPerLine + 1);
      if (inflated.length < offset + consumed) {
        throw new Error("Interlaced PNG data is truncated.");
      }
      const lines = unfilter(inflated, offset, passHeight, bytesPerLine, filterStride);
      writePass(
        context,
        lines,
        bytesPerLine,
        passWidth,
        passHeight,
        ADAM7_X_ORIGIN[pass],
        ADAM7_Y_ORIGIN[pass],
        ADAM7_X_STEP[pass],
        ADAM7_Y_STEP[pass]
      );
      offset += consumed;
    }
  } else {
    throw new Error(`Unsupported PNG interlace method: ${interlace}`);
  }

  return {
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    downsample: 1,
    data: output,
    bitDepth,
    colorType,
    // data の各サンプルは「整数値 / sampleMax」で入っている。呼び出し側が
    // sRGB -> linear の LUT を引くために整数値へ戻せるようにしておく。
    // パレット画像だけは PLTE が常に 8bit なので分母が 255 になる。
    sampleMax: colorType === 3 ? 255 : (1 << bitDepth) - 1,
    interlace,
    hasAlpha: colorType === 4 || colorType === 6 || Boolean(chunks.paletteAlpha) || Boolean(chunks.transparent),
    gamma: chunks.gamma,
    srgbIntent: chunks.srgbIntent,
    hasIccProfile: chunks.hasIccProfile
  };
}

async function decodeLargePngPreview(chunks, header, maxPixels) {
  const { width: sourceWidth, height: sourceHeight, bitDepth, colorType } = header;
  const downsample = Math.max(2, Math.ceil(Math.sqrt((sourceWidth * sourceHeight) / maxPixels)));
  const width = Math.ceil(sourceWidth / downsample);
  const height = Math.ceil(sourceHeight / downsample);
  const samplesPerPixel = samplesForColorType(colorType);
  const bytesPerSample = bitDepth / 8;
  const filterStride = samplesPerPixel * bytesPerSample;
  const bytesPerLine = sourceWidth * filterStride;
  const sampleMax = bitDepth === 16 ? 65535 : 255;
  const output = new Float32Array(width * height * 4);

  const stream = new Blob(chunks.idat).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const packet = new Uint8Array(bytesPerLine + 1);
  let previous = new Uint8Array(bytesPerLine);
  let current = new Uint8Array(bytesPerLine);
  let streamChunk = new Uint8Array(0);
  let streamOffset = 0;

  async function fillPacket() {
    let targetOffset = 0;
    while (targetOffset < packet.length) {
      if (streamOffset >= streamChunk.length) {
        const next = await reader.read();
        if (next.done) {
          throw new Error("PNG data is truncated.");
        }
        streamChunk = next.value;
        streamOffset = 0;
      }
      const count = Math.min(packet.length - targetOffset, streamChunk.length - streamOffset);
      packet.set(streamChunk.subarray(streamOffset, streamOffset + count), targetOffset);
      targetOffset += count;
      streamOffset += count;
    }
  }

  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    await fillPacket();
    if (packet[0] > 4) {
      throw new Error(`Unsupported PNG filter type ${packet[0]} on row ${sourceY}.`);
    }
    unfilterRow(packet[0], packet.subarray(1), current, previous, filterStride);
    const outputY = Math.floor(sourceY / downsample);
    const representativeY = Math.min(sourceHeight - 1, outputY * downsample + Math.floor(downsample / 2));
    if (sourceY === representativeY) {
      writePreviewSampleRow(
        current,
        output,
        outputY,
        width,
        sourceWidth,
        downsample,
        samplesPerPixel,
        bytesPerSample,
        sampleMax,
        colorType,
        chunks.transparent
      );
    }

    const swap = previous;
    previous = current;
    current = swap;
  }
  await reader.cancel();

  return {
    width,
    height,
    sourceWidth,
    sourceHeight,
    downsample,
    data: output,
    bitDepth,
    colorType,
    sampleMax,
    interlace: 0,
    hasAlpha: colorType === 6,
    gamma: chunks.gamma,
    srgbIntent: chunks.srgbIntent,
    hasIccProfile: chunks.hasIccProfile
  };
}

function writePreviewSampleRow(
  row,
  output,
  outputY,
  outputWidth,
  sourceWidth,
  downsample,
  samplesPerPixel,
  bytesPerSample,
  sampleMax,
  colorType,
  transparent
) {
  const inverseMax = 1 / sampleMax;
  const pixelStride = samplesPerPixel * bytesPerSample;
  const grayKey = transparent?.length >= 2 ? (transparent[0] << 8) | transparent[1] : -1;
  const redKey = colorType === 2 && transparent?.length >= 6 ? (transparent[0] << 8) | transparent[1] : -1;
  const greenKey = colorType === 2 && transparent?.length >= 6 ? (transparent[2] << 8) | transparent[3] : -1;
  const blueKey = colorType === 2 && transparent?.length >= 6 ? (transparent[4] << 8) | transparent[5] : -1;
  let target = outputY * outputWidth * 4;
  for (let outputX = 0; outputX < outputWidth; outputX += 1) {
    const sourceX = Math.min(sourceWidth - 1, outputX * downsample + Math.floor(downsample / 2));
    const source = sourceX * pixelStride;
    const first = bytesPerSample === 1 ? row[source] : (row[source] << 8) | row[source + 1];
    if (colorType === 0 || colorType === 4) {
      const value = first * inverseMax;
      output[target] = value;
      output[target + 1] = value;
      output[target + 2] = value;
      output[target + 3] = colorType === 4
        ? (bytesPerSample === 1 ? row[source + 1] : (row[source + 2] << 8) | row[source + 3]) * inverseMax
        : first === grayKey ? 0 : 1;
    } else {
      const greenOffset = source + bytesPerSample;
      const blueOffset = source + bytesPerSample * 2;
      const green = bytesPerSample === 1 ? row[greenOffset] : (row[greenOffset] << 8) | row[greenOffset + 1];
      const blue = bytesPerSample === 1 ? row[blueOffset] : (row[blueOffset] << 8) | row[blueOffset + 1];
      output[target] = first * inverseMax;
      output[target + 1] = green * inverseMax;
      output[target + 2] = blue * inverseMax;
      const alphaOffset = source + bytesPerSample * 3;
      output[target + 3] = colorType === 6
        ? (bytesPerSample === 1 ? row[alphaOffset] : (row[alphaOffset] << 8) | row[alphaOffset + 1]) * inverseMax
        : first === redKey && green === greenKey && blue === blueKey ? 0 : 1;
    }
    target += 4;
  }
}

function unfilterRow(filterType, filtered, current, previous, filterStride) {
  for (let index = 0; index < filtered.length; index += 1) {
    const rawValue = filtered[index];
    const left = index >= filterStride ? current[index - filterStride] : 0;
    const up = previous[index];
    const upLeft = index >= filterStride ? previous[index - filterStride] : 0;
    let value;
    switch (filterType) {
      case 0: value = rawValue; break;
      case 1: value = rawValue + left; break;
      case 2: value = rawValue + up; break;
      case 3: value = rawValue + ((left + up) >> 1); break;
      case 4: value = rawValue + paeth(left, up, upLeft); break;
      default: throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }
    current[index] = value & 0xff;
  }
}

function accumulatePreviewRow(
  row,
  accumulator,
  columnCounts,
  downsample,
  samplesPerPixel,
  bytesPerSample,
  sampleMax,
  colorType,
  transparent
) {
  const inverseMax = 1 / sampleMax;
  const pixelStride = samplesPerPixel * bytesPerSample;
  const grayKey = transparent && transparent.length >= 2 ? (transparent[0] << 8) | transparent[1] : -1;
  const redKey = colorType === 2 && transparent?.length >= 6 ? (transparent[0] << 8) | transparent[1] : -1;
  const greenKey = colorType === 2 && transparent?.length >= 6 ? (transparent[2] << 8) | transparent[3] : -1;
  const blueKey = colorType === 2 && transparent?.length >= 6 ? (transparent[4] << 8) | transparent[5] : -1;

  for (let column = 0; column < columnCounts.length; column += 1) {
    const firstX = column * downsample;
    const pixelCount = columnCounts[column];
    let source = firstX * pixelStride;
    const target = column * 4;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const first = bytesPerSample === 1 ? row[source] : (row[source] << 8) | row[source + 1];
      if (colorType === 0 || colorType === 4) {
        const value = first * inverseMax;
        accumulator[target] += value;
        accumulator[target + 1] += value;
        accumulator[target + 2] += value;
        const alpha = colorType === 4
          ? (bytesPerSample === 1 ? row[source + 1] : (row[source + 2] << 8) | row[source + 3]) * inverseMax
          : first === grayKey ? 0 : 1;
        accumulator[target + 3] += alpha;
      } else {
        const greenOffset = source + bytesPerSample;
        const blueOffset = source + bytesPerSample * 2;
        const green = bytesPerSample === 1 ? row[greenOffset] : (row[greenOffset] << 8) | row[greenOffset + 1];
        const blue = bytesPerSample === 1 ? row[blueOffset] : (row[blueOffset] << 8) | row[blueOffset + 1];
        accumulator[target] += first * inverseMax;
        accumulator[target + 1] += green * inverseMax;
        accumulator[target + 2] += blue * inverseMax;
        const alphaOffset = source + bytesPerSample * 3;
        const alpha = colorType === 6
          ? (bytesPerSample === 1 ? row[alphaOffset] : (row[alphaOffset] << 8) | row[alphaOffset + 1]) * inverseMax
          : first === redKey && green === greenKey && blue === blueKey ? 0 : 1;
        accumulator[target + 3] += alpha;
      }
      source += pixelStride;
    }
  }
}

function readChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = {
    header: null,
    idat: [],
    palette: null,
    paletteAlpha: null,
    transparent: null,
    gamma: null,
    srgbIntent: null,
    hasIccProfile: false
  };

  let offset = SIGNATURE.length;
  let chunkIndex = 0;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`PNG chunk "${type}" extends past the end of the file.`);
    }
    const expectedCrc = view.getUint32(dataEnd);
    const actualCrc = pngCrc32(bytes, offset + 4, length + 4);
    if (actualCrc !== expectedCrc) {
      const error = new Error(`PNG ${type} chunk ${chunkIndex} has a CRC mismatch. The file is corrupted; download it again.`);
      error.code = "PNG_CRC";
      throw error;
    }

    if (type === "IHDR") {
      result.header = bytes.subarray(dataStart, dataEnd);
    } else if (type === "IDAT") {
      result.idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "PLTE") {
      result.palette = bytes.subarray(dataStart, dataEnd);
    } else if (type === "tRNS") {
      result.transparent = bytes.subarray(dataStart, dataEnd);
    } else if (type === "gAMA" && length >= 4) {
      const encoded = view.getUint32(dataStart);
      result.gamma = encoded > 0 ? encoded / 100000 : null;
    } else if (type === "sRGB" && length >= 1) {
      result.srgbIntent = bytes[dataStart];
    } else if (type === "iCCP") {
      result.hasIccProfile = true;
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4; // CRC 4 バイトを読み飛ばす
    chunkIndex += 1;
  }

  if (!result.header) {
    throw new Error("PNG is missing its IHDR chunk.");
  }
  if (result.idat.length === 0) {
    throw new Error("PNG is missing its IDAT chunks.");
  }

  // パレット画像の tRNS はインデックスごとのアルファ列
  if (result.palette && result.transparent) {
    result.paletteAlpha = result.transparent;
    result.transparent = null;
  }

  return result;
}

function pngCrc32(bytes, offset, length) {
  let crc = 0xffffffff;
  const end = offset + length;
  for (let index = offset; index < end; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseHeader(header) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const compression = header[10];
  const filter = header[11];
  const interlace = header[12];

  if (width <= 0 || height <= 0) {
    throw new Error("PNG has an invalid image size.");
  }
  if (compression !== 0) {
    throw new Error(`Unsupported PNG compression method: ${compression}`);
  }
  if (filter !== 0) {
    throw new Error(`Unsupported PNG filter method: ${filter}`);
  }
  if (![1, 2, 4, 8, 16].includes(bitDepth)) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  }
  if (![0, 2, 3, 4, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG color type: ${colorType}`);
  }
  // 色タイプごとに許されるビット深度は仕様で決まっている
  const allowed = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  };
  if (!allowed[colorType].includes(bitDepth)) {
    throw new Error(`PNG color type ${colorType} does not allow bit depth ${bitDepth}.`);
  }

  return { width, height, bitDepth, colorType, interlace };
}

function samplesForColorType(colorType) {
  if (colorType === 0 || colorType === 3) {
    return 1;
  }
  if (colorType === 4) {
    return 2;
  }
  if (colorType === 2) {
    return 3;
  }
  return 4;
}

function concatChunks(chunks) {
  if (chunks.length === 1) {
    return chunks[0];
  }
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("DecompressionStream is not available in this browser.");
  }
  // IDAT は zlib ラッパ付きなので "deflate"（"deflate-raw" ではない）
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function unfilter(raw, startOffset, height, bytesPerLine, filterStride) {
  const out = new Uint8Array(height * bytesPerLine);
  let pos = startOffset;

  for (let y = 0; y < height; y += 1) {
    const filterType = raw[pos];
    pos += 1;
    const lineStart = y * bytesPerLine;
    const prevStart = lineStart - bytesPerLine;

    for (let i = 0; i < bytesPerLine; i += 1) {
      const rawValue = raw[pos + i];
      const left = i >= filterStride ? out[lineStart + i - filterStride] : 0;
      const up = y > 0 ? out[prevStart + i] : 0;
      const upLeft = y > 0 && i >= filterStride ? out[prevStart + i - filterStride] : 0;

      let value;
      switch (filterType) {
        case 0:
          value = rawValue;
          break;
        case 1:
          value = rawValue + left;
          break;
        case 2:
          value = rawValue + up;
          break;
        case 3:
          value = rawValue + ((left + up) >> 1);
          break;
        case 4:
          value = rawValue + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter type: ${filterType}`);
      }
      out[lineStart + i] = value & 0xff;
    }

    pos += bytesPerLine;
  }

  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

function readSample(line, lineOffset, sampleIndex, bitDepth) {
  if (bitDepth === 8) {
    return line[lineOffset + sampleIndex];
  }
  if (bitDepth === 16) {
    const at = lineOffset + sampleIndex * 2;
    return (line[at] << 8) | line[at + 1];
  }
  const samplesPerByte = 8 / bitDepth;
  const byte = line[lineOffset + Math.floor(sampleIndex / samplesPerByte)];
  const shift = 8 - bitDepth * ((sampleIndex % samplesPerByte) + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

// 8bit サンプルを 0..1 に正規化するための表（除算を避けつつ b/255 と同じ値にする）
const BYTE_TO_UNIT = new Float32Array(256);
for (let value = 0; value < 256; value += 1) {
  BYTE_TO_UNIT[value] = value / 255;
}

function writePass(context, lines, bytesPerLine, passWidth, passHeight, xOrigin, yOrigin, xStep, yStep) {
  const { bitDepth, colorType, samplesPerPixel, maxValue, palette, paletteAlpha, transparent, output, outputWidth } = context;
  const inverseMax = 1 / maxValue;

  // 実際に多い 8bit RGB / RGBA は、サンプル取り出しの分岐を挟まない専用ループで処理する
  if (bitDepth === 8 && (colorType === 6 || (colorType === 2 && !transparent))) {
    const hasAlpha = colorType === 6;
    const targetStep = xStep * 4;
    for (let row = 0; row < passHeight; row += 1) {
      let source = row * bytesPerLine;
      let target = ((yOrigin + row * yStep) * outputWidth + xOrigin) * 4;
      for (let column = 0; column < passWidth; column += 1) {
        output[target] = BYTE_TO_UNIT[lines[source]];
        output[target + 1] = BYTE_TO_UNIT[lines[source + 1]];
        output[target + 2] = BYTE_TO_UNIT[lines[source + 2]];
        output[target + 3] = hasAlpha ? BYTE_TO_UNIT[lines[source + 3]] : 1;
        source += samplesPerPixel;
        target += targetStep;
      }
    }
    return;
  }

  // tRNS（パレット以外）は「この値と完全一致する画素を透明にする」指定
  let keyR = -1;
  let keyG = -1;
  let keyB = -1;
  if (transparent) {
    if (colorType === 0 && transparent.length >= 2) {
      keyR = (transparent[0] << 8) | transparent[1];
      keyG = keyR;
      keyB = keyR;
    } else if (colorType === 2 && transparent.length >= 6) {
      keyR = (transparent[0] << 8) | transparent[1];
      keyG = (transparent[2] << 8) | transparent[3];
      keyB = (transparent[4] << 8) | transparent[5];
    }
  }

  for (let row = 0; row < passHeight; row += 1) {
    const lineOffset = row * bytesPerLine;
    const targetY = yOrigin + row * yStep;

    for (let column = 0; column < passWidth; column += 1) {
      const base = column * samplesPerPixel;
      const targetX = xOrigin + column * xStep;
      const target = (targetY * outputWidth + targetX) * 4;

      if (colorType === 3) {
        const index = readSample(lines, lineOffset, base, bitDepth);
        const paletteAt = index * 3;
        if (!palette || paletteAt + 2 >= palette.length) {
          throw new Error(`PNG palette index ${index} is out of range.`);
        }
        output[target] = palette[paletteAt] / 255;
        output[target + 1] = palette[paletteAt + 1] / 255;
        output[target + 2] = palette[paletteAt + 2] / 255;
        output[target + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] / 255 : 1;
        continue;
      }

      if (colorType === 0 || colorType === 4) {
        const gray = readSample(lines, lineOffset, base, bitDepth);
        const value = gray * inverseMax;
        output[target] = value;
        output[target + 1] = value;
        output[target + 2] = value;
        if (colorType === 4) {
          output[target + 3] = readSample(lines, lineOffset, base + 1, bitDepth) * inverseMax;
        } else {
          output[target + 3] = gray === keyR ? 0 : 1;
        }
        continue;
      }

      const r = readSample(lines, lineOffset, base, bitDepth);
      const g = readSample(lines, lineOffset, base + 1, bitDepth);
      const b = readSample(lines, lineOffset, base + 2, bitDepth);
      output[target] = r * inverseMax;
      output[target + 1] = g * inverseMax;
      output[target + 2] = b * inverseMax;
      if (colorType === 6) {
        output[target + 3] = readSample(lines, lineOffset, base + 3, bitDepth) * inverseMax;
      } else {
        output[target + 3] = r === keyR && g === keyG && b === keyB ? 0 : 1;
      }
    }
  }
}

/** metaType 表示用の短いラベル。 */
export function pngTypeLabel(decoded) {
  const names = {
    0: "gray",
    2: "rgb",
    3: "palette",
    4: "gray-alpha",
    6: "rgba"
  };
  const name = names[decoded.colorType] || `type${decoded.colorType}`;
  return `png/${name}${decoded.bitDepth}`;
}
