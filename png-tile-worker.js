const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TILE_SIZE = 512;

let state = null;

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type === "raster-init") {
    await initialize(message);
  } else if (message.type === "raster-request") {
    await handleRequest(message);
  } else if (message.type === "raster-dispose") {
    state = null;
    self.close();
  }
});

async function initialize(message) {
  try {
    const parsed = await parsePngFile(message.file);
    if (parsed.interlace !== 0 || ![8, 16].includes(parsed.bitDepth) || ![0, 2, 4, 6].includes(parsed.colorType)) {
      throw new Error("Tiled PNG requires non-interlaced 8/16-bit Gray, Gray+Alpha, RGB, or RGBA data.");
    }
    state = await decodeToCompactTiles(parsed, message.id, message.maxPreviewPixels || 4_194_304);
    const preview = state.preview;
    const transferredPreview = preview.pixels.slice();
    self.postMessage({
      id: message.id,
      type: "raster-ready",
      result: {
        width: state.width,
        height: state.height,
        bitDepth: state.bitDepth,
        colorType: state.colorType,
        hasAlpha: state.hasAlpha,
        gamma: parsed.gamma,
        srgbIntent: parsed.srgbIntent,
        hasIccProfile: parsed.hasIccProfile,
        previewWidth: preview.width,
        previewHeight: preview.height,
        previewPixels: transferredPreview.buffer
      }
    }, [transferredPreview.buffer]);
  } catch (error) {
    state = null;
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
}

async function parsePngFile(file) {
  if (!(file instanceof Blob) || file.size < 33) throw new Error("Invalid PNG file.");
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!SIGNATURE.every((value, index) => signature[index] === value)) throw new Error("Not a PNG file.");
  let offset = 8;
  let header = null;
  const idat = [];
  let transparent = null;
  let gamma = null;
  let srgbIntent = null;
  let hasIccProfile = false;
  while (offset + 12 <= file.size) {
    const chunkHeader = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
    const view = new DataView(chunkHeader.buffer);
    const length = view.getUint32(0);
    const type = String.fromCharCode(chunkHeader[4], chunkHeader[5], chunkHeader[6], chunkHeader[7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > file.size) throw new Error("PNG chunk exceeds file size.");
    if (type === "IHDR") {
      const data = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
      const dataView = new DataView(data.buffer);
      header = {
        width: dataView.getUint32(0),
        height: dataView.getUint32(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === "IDAT") {
      idat.push(file.slice(dataStart, dataEnd));
    } else if (type === "tRNS") {
      transparent = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer());
    } else if (type === "gAMA" && length === 4) {
      const data = await file.slice(dataStart, dataEnd).arrayBuffer();
      gamma = new DataView(data).getUint32(0) / 100000;
    } else if (type === "sRGB" && length >= 1) {
      srgbIntent = new Uint8Array(await file.slice(dataStart, dataEnd).arrayBuffer())[0];
    } else if (type === "iCCP") {
      hasIccProfile = true;
    }
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  if (!header || !idat.length) throw new Error("PNG is missing IHDR or IDAT data.");
  return { ...header, idat, transparent, gamma, srgbIntent, hasIccProfile };
}

function samplesForColorType(colorType) {
  return colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
}

async function decodeToCompactTiles(parsed, initId, maxPreviewPixels) {
  const { width, height, bitDepth, colorType, transparent } = parsed;
  const channels = samplesForColorType(colorType);
  const bytesPerSample = bitDepth / 8;
  const pixelStride = channels * bytesPerSample;
  const bytesPerLine = width * pixelStride;
  const downsample = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxPreviewPixels)));
  const previewWidth = Math.ceil(width / downsample);
  const previewHeight = Math.ceil(height / downsample);
  const previewPixels = new Float32Array(previewWidth * previewHeight * 4);
  const tiles = new Map();
  const stream = new Blob(parsed.idat).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const packet = new Uint8Array(bytesPerLine + 1);
  let previous = new Uint8Array(bytesPerLine);
  let current = new Uint8Array(bytesPerLine);
  let streamChunk = new Uint8Array(0);
  let streamOffset = 0;

  async function fillPacket() {
    let target = 0;
    while (target < packet.length) {
      if (streamOffset >= streamChunk.length) {
        const next = await reader.read();
        if (next.done) throw new Error("PNG data is truncated.");
        streamChunk = next.value;
        streamOffset = 0;
      }
      const count = Math.min(packet.length - target, streamChunk.length - streamOffset);
      packet.set(streamChunk.subarray(streamOffset, streamOffset + count), target);
      target += count;
      streamOffset += count;
    }
  }

  const result = {
    width,
    height,
    bitDepth,
    colorType,
    channels,
    bytesPerSample,
    transparent,
    tiles,
    hasAlpha: colorType === 4 || colorType === 6 || Boolean(transparent),
    preview: { width: previewWidth, height: previewHeight, downsample, pixels: previewPixels }
  };
  for (let y = 0; y < height; y += 1) {
    await fillPacket();
    if (packet[0] > 4) throw new Error(`Unsupported PNG filter ${packet[0]} at row ${y}.`);
    unfilterRow(packet[0], packet.subarray(1), current, previous, pixelStride);
    storeCompactRow(result, current, y);
    const previewY = Math.floor(y / downsample);
    const representativeY = Math.min(height - 1, previewY * downsample + Math.floor(downsample / 2));
    if (y === representativeY) writePreviewRow(result, current, previewY);
    if ((y & 255) === 0) {
      self.postMessage({ id: initId, type: "progress", progress: Math.round(y / height * 100), label: `Decoding PNG rows ${y}/${height}` });
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  await reader.cancel();
  return result;
}

function compactTile(source, tileX, tileY) {
  const key = `${tileX}:${tileY}`;
  let tile = source.tiles.get(key);
  if (tile) return tile;
  const width = Math.min(TILE_SIZE, source.width - tileX * TILE_SIZE);
  const height = Math.min(TILE_SIZE, source.height - tileY * TILE_SIZE);
  const ArrayType = source.bitDepth === 16 ? Uint16Array : Uint8Array;
  tile = { width, height, values: new ArrayType(width * height * source.channels) };
  source.tiles.set(key, tile);
  return tile;
}

function storeCompactRow(source, row, y) {
  const tileY = Math.floor(y / TILE_SIZE);
  const localY = y - tileY * TILE_SIZE;
  const tileColumns = Math.ceil(source.width / TILE_SIZE);
  for (let tileX = 0; tileX < tileColumns; tileX += 1) {
    const tile = compactTile(source, tileX, tileY);
    const sourceX = tileX * TILE_SIZE;
    const samples = tile.width * source.channels;
    const target = localY * samples;
    if (source.bitDepth === 8) {
      tile.values.set(row.subarray(sourceX * source.channels, sourceX * source.channels + samples), target);
    } else {
      let byte = sourceX * source.channels * 2;
      for (let index = 0; index < samples; index += 1) {
        tile.values[target + index] = (row[byte] << 8) | row[byte + 1];
        byte += 2;
      }
    }
  }
}

function writePreviewRow(source, row, previewY) {
  const { width, downsample } = source.preview;
  const max = source.bitDepth === 16 ? 65535 : 255;
  for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(source.width - 1, x * downsample + Math.floor(downsample / 2));
    const rgba = decodeRowPixel(source, row, sourceX, max);
    const target = (previewY * width + x) * 4;
    source.preview.pixels.set(rgba, target);
  }
}

function decodeRowPixel(source, row, x, max) {
  const sample = (channel) => {
    const index = (x * source.channels + channel) * source.bytesPerSample;
    return source.bitDepth === 16 ? (row[index] << 8) | row[index + 1] : row[index];
  };
  return decodeSamples(source, sample, max);
}

function decodeSamples(source, sample, max = source.bitDepth === 16 ? 65535 : 255) {
  if (source.colorType === 0 || source.colorType === 4) {
    const encoded = sample(0) / max;
    const gray = srgbToLinear(encoded);
    const transparentKey = source.transparent?.length >= 2 ? (source.transparent[0] << 8) | source.transparent[1] : -1;
    const alpha = source.colorType === 4 ? sample(1) / max : sample(0) === transparentKey ? 0 : 1;
    return [gray, gray, gray, alpha];
  }
  const red = sample(0);
  const green = sample(1);
  const blue = sample(2);
  const redKey = source.transparent?.length >= 6 ? (source.transparent[0] << 8) | source.transparent[1] : -1;
  const greenKey = source.transparent?.length >= 6 ? (source.transparent[2] << 8) | source.transparent[3] : -1;
  const blueKey = source.transparent?.length >= 6 ? (source.transparent[4] << 8) | source.transparent[5] : -1;
  const alpha = source.colorType === 6 ? sample(3) / max : red === redKey && green === greenKey && blue === blueKey ? 0 : 1;
  return [srgbToLinear(red / max), srgbToLinear(green / max), srgbToLinear(blue / max), alpha];
}

function compactPixel(source, x, y) {
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  const tile = compactTile(source, tileX, tileY);
  const localX = x - tileX * TILE_SIZE;
  const localY = y - tileY * TILE_SIZE;
  const base = (localY * tile.width + localX) * source.channels;
  return decodeSamples(source, (channel) => tile.values[base + channel]);
}

async function handleRequest(message) {
  if (!state) {
    self.postMessage({ id: message.id, type: "error", message: "PNG tile source is not initialized." });
    return;
  }
  try {
    let result;
    if (message.operation === "tile") result = buildOutputTile(message);
    else if (message.operation === "region") result = buildRegion(message.rect);
    else if (message.operation === "preview") result = previewResult();
    else throw new Error(`Unknown PNG raster operation: ${message.operation}.`);
    self.postMessage({ id: message.id, type: "result", result }, [result.pixels]);
  } catch (error) {
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
}

function buildOutputTile({ level, tileX, tileY, gutter = 1 }) {
  const factor = 2 ** level;
  const levelWidth = Math.ceil(state.width / factor);
  const levelHeight = Math.ceil(state.height / factor);
  const levelX = tileX * TILE_SIZE;
  const levelY = tileY * TILE_SIZE;
  const width = Math.min(TILE_SIZE, levelWidth - levelX);
  const height = Math.min(TILE_SIZE, levelHeight - levelY);
  if (width < 1 || height < 1) throw new Error("PNG tile is outside the image.");
  const stride = width + gutter * 2;
  const pixels = new Float32Array(stride * (height + gutter * 2) * 4);
  for (let y = -gutter; y < height + gutter; y += 1) {
    const levelSampleY = Math.max(0, Math.min(levelHeight - 1, levelY + y));
    for (let x = -gutter; x < width + gutter; x += 1) {
      const levelSampleX = Math.max(0, Math.min(levelWidth - 1, levelX + x));
      const rgba = averageOutputPixel(levelSampleX * factor, levelSampleY * factor, factor);
      pixels.set(rgba, ((y + gutter) * stride + x + gutter) * 4);
    }
  }
  return { level, tileX, tileY, gutter, width, height, stride, pixels: pixels.buffer };
}

function averageOutputPixel(sourceX, sourceY, factor) {
  const right = Math.min(state.width, sourceX + factor);
  const bottom = Math.min(state.height, sourceY + factor);
  const preview = state.preview;
  let red = 0, green = 0, blue = 0, alpha = 0, count = 0;
  if (factor >= preview.downsample) {
    const leftP = Math.floor(sourceX / preview.downsample);
    const topP = Math.floor(sourceY / preview.downsample);
    const rightP = Math.min(preview.width, Math.ceil(right / preview.downsample));
    const bottomP = Math.min(preview.height, Math.ceil(bottom / preview.downsample));
    for (let y = topP; y < bottomP; y += 1) for (let x = leftP; x < rightP; x += 1) {
      const offset = (y * preview.width + x) * 4;
      red += preview.pixels?.[offset] ?? 0;
      green += preview.pixels?.[offset + 1] ?? 0;
      blue += preview.pixels?.[offset + 2] ?? 0;
      alpha += preview.pixels?.[offset + 3] ?? 1;
      count += 1;
    }
  } else {
    for (let y = sourceY; y < bottom; y += 1) for (let x = sourceX; x < right; x += 1) {
      const rgba = compactPixel(state, x, y);
      red += rgba[0]; green += rgba[1]; blue += rgba[2]; alpha += rgba[3]; count += 1;
    }
  }
  const scale = count ? 1 / count : 0;
  return [red * scale, green * scale, blue * scale, alpha * scale];
}

function buildRegion(rect) {
  const pixels = new Float32Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
    pixels.set(compactPixel(state, rect.x + x, rect.y + y), (y * rect.width + x) * 4);
  }
  return { width: rect.width, height: rect.height, pixels: pixels.buffer };
}

function previewResult() {
  const source = state.preview.pixels;
  const copy = source.slice();
  return { width: state.preview.width, height: state.preview.height, pixels: copy.buffer };
}

function unfilterRow(filterType, filtered, current, previous, stride) {
  for (let index = 0; index < filtered.length; index += 1) {
    const raw = filtered[index];
    const left = index >= stride ? current[index - stride] : 0;
    const up = previous[index];
    const upLeft = index >= stride ? previous[index - stride] : 0;
    let value;
    if (filterType === 0) value = raw;
    else if (filterType === 1) value = raw + left;
    else if (filterType === 2) value = raw + up;
    else if (filterType === 3) value = raw + ((left + up) >> 1);
    else value = raw + paeth(left, up, upLeft);
    current[index] = value & 255;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
