const TILE_SIZE = 512;
let state = null;
const rowCache = new Map();
const inFlightRows = new Map();
const MAX_CACHED_ROWS = 600;

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "raster-dispose") {
    state = null;
    rowCache.clear();
    inFlightRows.clear();
    return;
  }
  try {
    let result;
    if (message.type === "raster-init") result = await initialize(message.file);
    else if (message.type === "raster-request" && message.operation === "tile") result = await getTile(message);
    else if (message.type === "raster-request" && message.operation === "region") result = await getRegion(message.rect);
    else if (message.type === "raster-request" && message.operation === "pixel") result = await getPixel(message.x, message.y);
    else if (message.type === "raster-request" && message.operation === "preview") result = await getPreview(message.maximumEdge);
    else throw new Error(`Unsupported EXR worker request: ${message.type}/${message.operation || ""}`);
    const transfers = [];
    if (result.pixels instanceof ArrayBuffer) transfers.push(result.pixels);
    if (result.previewPixels instanceof ArrayBuffer) transfers.push(result.previewPixels);
    self.postMessage({ id: message.id, type: message.type === "raster-init" ? "result" : "raster-result", result }, transfers);
  } catch (error) {
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
};

async function initialize(file) {
  if (!(file instanceof Blob)) throw new Error("EXR streaming requires a File or Blob.");
  const headerBytes = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
  const header = parseHeader(headerBytes);
  if (header.compression !== 2) throw new Error("Streaming currently supports ZIPS-compressed EXR files only.");
  if (header.channels.length !== 3 || header.channels.some((channel) => channel.pixelType !== 2 || channel.xSampling !== 1 || channel.ySampling !== 1)) {
    throw new Error("Streaming currently supports full-resolution RGB 32F EXR channels only.");
  }
  const width = header.xMax - header.xMin + 1;
  const height = header.yMax - header.yMin + 1;
  const tableBytes = await file.slice(header.end, header.end + height * 8).arrayBuffer();
  const table = new DataView(tableBytes);
  const offsets = new Array(height);
  for (let index = 0; index < height; index += 1) offsets[index] = Number(table.getBigUint64(index * 8, true));
  state = {
    file, width, height, yMin: header.yMin, channels: header.channels, offsets,
    channelIndex: Object.fromEntries(header.channels.map((channel, index) => [channel.name, index]))
  };
  const preview = await getPreview(1024);
  return {
    width,
    height,
    previewWidth: preview.width,
    previewHeight: preview.height,
    previewPixels: preview.pixels
  };
}

function parseHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 20000630) throw new Error("Invalid OpenEXR signature.");
  let offset = 8;
  const header = { channels: [], compression: -1, xMin: 0, yMin: 0, xMax: -1, yMax: -1 };
  while (offset < bytes.length) {
    const name = readString(bytes, offset); offset = name.next;
    if (!name.value) { header.end = offset; return header; }
    const type = readString(bytes, offset); offset = type.next;
    const size = view.getUint32(offset, true); offset += 4;
    const end = offset + size;
    if (name.value === "compression") header.compression = bytes[offset];
    if (name.value === "dataWindow") {
      header.xMin = view.getInt32(offset, true); header.yMin = view.getInt32(offset + 4, true);
      header.xMax = view.getInt32(offset + 8, true); header.yMax = view.getInt32(offset + 12, true);
    }
    if (name.value === "channels") {
      let channelOffset = offset;
      while (channelOffset < end) {
        const channelName = readString(bytes, channelOffset); channelOffset = channelName.next;
        if (!channelName.value) break;
        header.channels.push({
          name: channelName.value,
          pixelType: view.getInt32(channelOffset, true),
          xSampling: view.getInt32(channelOffset + 8, true),
          ySampling: view.getInt32(channelOffset + 12, true)
        });
        channelOffset += 16;
      }
    }
    offset = end;
  }
  throw new Error("OpenEXR header is incomplete.");
}

function readString(bytes, start) {
  let end = start;
  while (end < bytes.length && bytes[end]) end += 1;
  return { value: new TextDecoder().decode(bytes.subarray(start, end)), next: end + 1 };
}

async function decodeRow(y) {
  const cached = rowCache.get(y);
  if (cached) {
    rowCache.delete(y); rowCache.set(y, cached); return cached;
  }
  const pending = inFlightRows.get(y);
  if (pending) return pending;
  const promise = decodeRowUncached(y);
  inFlightRows.set(y, promise);
  try {
    return await promise;
  } finally {
    inFlightRows.delete(y);
  }
}

async function decodeRowUncached(y) {
  const fileRow = y;
  const offset = state.offsets[fileRow];
  const chunkHeader = new DataView(await state.file.slice(offset, offset + 8).arrayBuffer());
  const storedY = chunkHeader.getInt32(0, true) - state.yMin;
  const packedSize = chunkHeader.getUint32(4, true);
  const packed = state.file.slice(offset + 8, offset + 8 + packedSize);
  const expectedSize = state.width * state.channels.length * 4;
  let raw;
  if (packedSize === expectedSize) {
    raw = new Uint8Array(await packed.arrayBuffer());
  } else {
    const stream = packed.stream().pipeThrough(new DecompressionStream("deflate"));
    const shuffled = new Uint8Array(await new Response(stream).arrayBuffer());
    for (let i = 1; i < shuffled.length; i += 1) shuffled[i] = (shuffled[i - 1] + shuffled[i] - 128) & 255;
    raw = new Uint8Array(shuffled.length);
    let first = 0;
    let second = Math.floor((shuffled.length + 1) / 2);
    for (let i = 0; i < raw.length; i += 2) {
      raw[i] = shuffled[first++];
      if (i + 1 < raw.length) raw[i + 1] = shuffled[second++];
    }
  }
  const planar = new Float32Array(raw.buffer);
  if (storedY !== fileRow) throw new Error("EXR scanline offset table is inconsistent.");
  rowCache.set(y, planar);
  while (rowCache.size > MAX_CACHED_ROWS) rowCache.delete(rowCache.keys().next().value);
  return planar;
}

function copyPixel(row, x, target, offset) {
  target[offset] = row[state.channelIndex.R * state.width + x];
  target[offset + 1] = row[state.channelIndex.G * state.width + x];
  target[offset + 2] = row[state.channelIndex.B * state.width + x];
  target[offset + 3] = 1;
}

async function getTile({ level, tileX, tileY, gutter = 1 }) {
  const factor = 2 ** level;
  const levelWidth = Math.ceil(state.width / factor);
  const levelHeight = Math.ceil(state.height / factor);
  const levelX = tileX * TILE_SIZE;
  const levelY = tileY * TILE_SIZE;
  const width = Math.min(TILE_SIZE, levelWidth - levelX);
  const height = Math.min(TILE_SIZE, levelHeight - levelY);
  const stride = width + gutter * 2;
  const pixels = new Float32Array(stride * (height + gutter * 2) * 4);
  const sourceYs = [];
  for (let y = -gutter; y < height + gutter; y += 1) sourceYs.push(clamp((levelY + y) * factor, 0, state.height - 1));
  const rows = [];
  for (let batch = 0; batch < sourceYs.length; batch += 16) {
    rows.push(...await Promise.all(sourceYs.slice(batch, batch + 16).map(decodeRow)));
  }
  for (let y = -gutter; y < height + gutter; y += 1) {
    const row = rows[y + gutter];
    for (let x = -gutter; x < width + gutter; x += 1) {
      const sourceX = clamp((levelX + x) * factor, 0, state.width - 1);
      copyPixel(row, sourceX, pixels, ((y + gutter) * stride + x + gutter) * 4);
    }
  }
  return { level, tileX, tileY, gutter, width, height, stride, pixels: pixels.buffer };
}

async function getPixel(x, y) {
  const row = await decodeRow(clamp(Math.trunc(y), 0, state.height - 1));
  const values = new Float32Array(4);
  copyPixel(row, clamp(Math.trunc(x), 0, state.width - 1), values, 0);
  return { values: Array.from(values) };
}

async function getRegion(rect) {
  const pixels = new Float32Array(rect.width * rect.height * 4);
  for (let batch = 0; batch < rect.height; batch += 16) {
    const count = Math.min(16, rect.height - batch);
    const rows = await Promise.all(Array.from({ length: count }, (_, i) => decodeRow(rect.y + batch + i)));
    rows.forEach((row, i) => {
      for (let x = 0; x < rect.width; x += 1) copyPixel(row, rect.x + x, pixels, ((batch + i) * rect.width + x) * 4);
    });
  }
  return { pixels: pixels.buffer };
}

async function getPreview(maximumEdge = 1024) {
  const scale = Math.min(1, maximumEdge / Math.max(state.width, state.height));
  const width = Math.max(1, Math.round(state.width * scale));
  const height = Math.max(1, Math.round(state.height * scale));
  const pixels = new Float32Array(width * height * 4);
  for (let batch = 0; batch < height; batch += 16) {
    const count = Math.min(16, height - batch);
    const sourceYs = Array.from({ length: count }, (_, i) => Math.min(state.height - 1, Math.floor((batch + i + 0.5) * state.height / height)));
    const rows = await Promise.all(sourceYs.map(decodeRow));
    rows.forEach((row, i) => {
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(state.width - 1, Math.floor((x + 0.5) * state.width / width));
        copyPixel(row, sourceX, pixels, ((batch + i) * width + x) * 4);
      }
    });
  }
  return { width, height, pixels: pixels.buffer };
}

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
