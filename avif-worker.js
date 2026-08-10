let rasterState = null;

const TILE_SIZE = 512;
const PQ_LUT_SIZE = 65536;
const pqToNitsLut = buildPqLut();
const averagePixelScratch = new Float32Array(4);

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type === "raster-init") {
    await initializeRaster(message);
    return;
  }
  if (message.type === "raster-request") {
    handleRasterRequest(message);
    return;
  }
  if (message.type === "raster-dispose") {
    rasterState = null;
    self.close();
  }
});

async function initializeRaster(message) {
  let decoder = null;
  let frame = null;
  try {
    if (typeof ImageDecoder !== "function") {
      throw new Error("WebCodecs ImageDecoder is unavailable in this Worker.");
    }
    self.postMessage({ id: message.id, type: "progress", progress: 0, label: "Starting exact AVIF decode" });
    decoder = new ImageDecoder({
      data: new Uint8Array(message.buffer),
      type: message.mimeType || "image/avif",
      preferAnimation: false
    });
    await decoder.tracks.ready;
    const decoded = await decoder.decode({ frameIndex: 0, completeFramesOnly: true });
    frame = decoded.image;
    const description = describeFrameFormat(frame.format);
    const allocationSize = frame.allocationSize();
    if (allocationSize > (message.maximumDecodedSampleBytes || 512 * 1024 * 1024)) {
      throw new Error(`Decoded AVIF planes require ${Math.ceil(allocationSize / 1048576)} MiB.`);
    }
    const raw = new ArrayBuffer(allocationSize);
    const layouts = await frame.copyTo(raw);
    if (layouts.length < 3) {
      throw new Error(`Unsupported AVIF plane layout: ${frame.format}.`);
    }

    const colorSpace = frame.colorSpace || {};
    const transfer = colorSpace.transfer || "unknown";
    const valueUnit = transfer === "pq" ? "nit" : "relative";
    rasterState = {
      width: frame.codedWidth,
      height: frame.codedHeight,
      raw,
      byteView: new Uint8Array(raw),
      dataView: new DataView(raw),
      layouts,
      ...description,
      primaries: colorSpace.primaries || "unknown",
      transfer,
      matrix: colorSpace.matrix || "unknown",
      fullRange: colorSpace.fullRange !== false,
      valueUnit,
      maxCode: 2 ** description.bitDepth - 1,
      midCode: 2 ** (description.bitDepth - 1),
      codeScale: 2 ** (description.bitDepth - 8),
      preview: null
    };
    validateColorDescription(rasterState);
    rasterState.preview = buildPreview(message.maximumPreviewEdge || 1024);
    const previewPixels = rasterState.preview.pixels.slice();
    self.postMessage({
      id: message.id,
      type: "raster-ready",
      result: {
        width: rasterState.width,
        height: rasterState.height,
        bitDepth: rasterState.bitDepth,
        frameFormat: rasterState.frameFormat,
        primaries: rasterState.primaries,
        transfer: rasterState.transfer,
        matrix: rasterState.matrix,
        fullRange: rasterState.fullRange,
        valueUnit: rasterState.valueUnit,
        previewWidth: rasterState.preview.width,
        previewHeight: rasterState.preview.height,
        previewPixels: previewPixels.buffer
      }
    }, [previewPixels.buffer]);
  } catch (error) {
    rasterState = null;
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  } finally {
    frame?.close();
    decoder?.close();
  }
}

function describeFrameFormat(frameFormat) {
  const match = /^I(420|422|444)(A)?(?:P(10|12))?$/.exec(frameFormat || "");
  if (!match) {
    throw new Error(`AVIF decoded to unsupported pixel format ${frameFormat || "unknown"}.`);
  }
  const subsampling = match[1];
  return {
    frameFormat,
    subsampling,
    hasAlpha: Boolean(match[2]),
    bitDepth: Number(match[3] || 8),
    bytesPerSample: match[3] ? 2 : 1,
    chromaShiftX: subsampling === "444" ? 0 : 1,
    chromaShiftY: subsampling === "420" ? 1 : 0
  };
}

function validateColorDescription(state) {
  if (!["rgb", "bt709", "bt470bg", "smpte170m", "bt2020-ncl"].includes(state.matrix)) {
    throw new Error(`Unsupported AVIF matrix coefficients: ${state.matrix}.`);
  }
  if (!["linear", "iec61966-2-1", "bt709", "smpte170m", "pq", "hlg"].includes(state.transfer)) {
    throw new Error(`Unsupported AVIF transfer characteristics: ${state.transfer}.`);
  }
  if (!["bt709", "bt2020", "smpte432"].includes(state.primaries)) {
    throw new Error(`Unsupported AVIF color primaries: ${state.primaries}.`);
  }
}

function handleRasterRequest(message) {
  if (!rasterState) {
    self.postMessage({ id: message.id, type: "error", message: "AVIF raster source is not initialized." });
    return;
  }
  try {
    let result;
    if (message.operation === "tile") result = buildTile(message);
    else if (message.operation === "region") result = buildRegion(message.rect);
    else if (message.operation === "preview") {
      const copy = rasterState.preview.pixels.slice();
      result = { width: rasterState.preview.width, height: rasterState.preview.height, pixels: copy.buffer };
    } else throw new Error(`Unknown AVIF raster operation: ${message.operation}.`);
    self.postMessage({ id: message.id, type: "result", result }, [result.pixels]);
  } catch (error) {
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
}

function buildPreview(maximumEdge) {
  const downsample = Math.max(1, Math.ceil(Math.max(rasterState.width, rasterState.height) / maximumEdge));
  const width = Math.ceil(rasterState.width / downsample);
  const height = Math.ceil(rasterState.height / downsample);
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(rasterState.height - 1, y * downsample + Math.floor(downsample / 2));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(rasterState.width - 1, x * downsample + Math.floor(downsample / 2));
      writeLinearPixel(pixels, (y * width + x) * 4, sourceX, sourceY);
    }
  }
  return { width, height, downsample, pixels };
}

function buildTile({ level, tileX, tileY, gutter = 1 }) {
  const factor = 2 ** level;
  const levelWidth = Math.ceil(rasterState.width / factor);
  const levelHeight = Math.ceil(rasterState.height / factor);
  const levelX = tileX * TILE_SIZE;
  const levelY = tileY * TILE_SIZE;
  const width = Math.min(TILE_SIZE, levelWidth - levelX);
  const height = Math.min(TILE_SIZE, levelHeight - levelY);
  if (width < 1 || height < 1) throw new Error("AVIF tile is outside the image.");
  const stride = width + gutter * 2;
  const pixels = new Float32Array(stride * (height + gutter * 2) * 4);
  for (let y = -gutter; y < height + gutter; y += 1) {
    const levelSampleY = Math.max(0, Math.min(levelHeight - 1, levelY + y));
    for (let x = -gutter; x < width + gutter; x += 1) {
      const levelSampleX = Math.max(0, Math.min(levelWidth - 1, levelX + x));
      writeAveragePixel(
        pixels,
        ((y + gutter) * stride + x + gutter) * 4,
        levelSampleX * factor,
        levelSampleY * factor,
        factor
      );
    }
  }
  return { level, tileX, tileY, gutter, width, height, stride, pixels: pixels.buffer };
}

function buildRegion(rect) {
  const x0 = Math.max(0, Math.min(rasterState.width, Math.floor(rect.x)));
  const y0 = Math.max(0, Math.min(rasterState.height, Math.floor(rect.y)));
  const width = Math.max(0, Math.min(rasterState.width - x0, Math.floor(rect.width)));
  const height = Math.max(0, Math.min(rasterState.height - y0, Math.floor(rect.height)));
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      writeLinearPixel(pixels, (y * width + x) * 4, x0 + x, y0 + y);
    }
  }
  return { width, height, pixels: pixels.buffer };
}

function writeAveragePixel(target, targetOffset, sourceX, sourceY, factor) {
  if (factor <= 1) {
    writeLinearPixel(target, targetOffset, sourceX, sourceY);
    return;
  }
  const right = Math.min(rasterState.width, sourceX + factor);
  const bottom = Math.min(rasterState.height, sourceY + factor);
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  for (let y = sourceY; y < bottom; y += 1) {
    for (let x = sourceX; x < right; x += 1) {
      writeLinearPixel(averagePixelScratch, 0, x, y);
      red += averagePixelScratch[0];
      green += averagePixelScratch[1];
      blue += averagePixelScratch[2];
      alpha += averagePixelScratch[3];
      count += 1;
    }
  }
  const scale = count ? 1 / count : 0;
  target[targetOffset] = red * scale;
  target[targetOffset + 1] = green * scale;
  target[targetOffset + 2] = blue * scale;
  target[targetOffset + 3] = alpha * scale;
}

function writeLinearPixel(target, targetOffset, x, y) {
  const state = rasterState;
  const yCode = samplePlane(0, x, y);
  const uCode = samplePlane(1, x >> state.chromaShiftX, y >> state.chromaShiftY);
  const vCode = samplePlane(2, x >> state.chromaShiftX, y >> state.chromaShiftY);
  const luma = state.fullRange ? yCode / state.maxCode : (yCode - 16 * state.codeScale) / (219 * state.codeScale);
  const chromaBlue = state.fullRange
    ? (uCode - state.midCode) / state.maxCode
    : (uCode - 128 * state.codeScale) / (224 * state.codeScale);
  const chromaRed = state.fullRange
    ? (vCode - state.midCode) / state.maxCode
    : (vCode - 128 * state.codeScale) / (224 * state.codeScale);

  let encodedRed;
  let encodedGreen;
  let encodedBlue;
  if (state.matrix === "rgb") {
    // AV1 identity matrix stores G, B, R in planes 0, 1, 2.
    encodedRed = vCode / state.maxCode;
    encodedGreen = yCode / state.maxCode;
    encodedBlue = uCode / state.maxCode;
  } else {
    const kr = state.matrix === "bt2020-ncl" ? 0.2627 : state.matrix === "bt709" ? 0.2126 : 0.299;
    const kb = state.matrix === "bt2020-ncl" ? 0.0593 : state.matrix === "bt709" ? 0.0722 : 0.114;
    encodedRed = luma + 2 * (1 - kr) * chromaRed;
    encodedBlue = luma + 2 * (1 - kb) * chromaBlue;
    encodedGreen = (luma - kr * encodedRed - kb * encodedBlue) / (1 - kr - kb);
  }

  const sourceRed = inverseTransfer(encodedRed, state.transfer);
  const sourceGreen = inverseTransfer(encodedGreen, state.transfer);
  const sourceBlue = inverseTransfer(encodedBlue, state.transfer);
  if (state.primaries === "bt2020") {
    target[targetOffset] = 1.660491 * sourceRed - 0.587641 * sourceGreen - 0.07285 * sourceBlue;
    target[targetOffset + 1] = -0.12455 * sourceRed + 1.1329 * sourceGreen - 0.008349 * sourceBlue;
    target[targetOffset + 2] = -0.018151 * sourceRed - 0.100579 * sourceGreen + 1.11873 * sourceBlue;
  } else if (state.primaries === "smpte432") {
    target[targetOffset] = 1.224745 * sourceRed - 0.224904 * sourceGreen - 0.0000003 * sourceBlue;
    target[targetOffset + 1] = -0.042058 * sourceRed + 1.042081 * sourceGreen - 0.0000002 * sourceBlue;
    target[targetOffset + 2] = -0.019642 * sourceRed - 0.078655 * sourceGreen + 1.098537 * sourceBlue;
  } else {
    target[targetOffset] = sourceRed;
    target[targetOffset + 1] = sourceGreen;
    target[targetOffset + 2] = sourceBlue;
  }
  target[targetOffset + 3] = state.hasAlpha && state.layouts[3]
    ? samplePlane(3, x, y) / state.maxCode
    : 1;
}

function samplePlane(plane, x, y) {
  const state = rasterState;
  const layout = state.layouts[plane];
  const offset = layout.offset + y * layout.stride + x * state.bytesPerSample;
  return state.bytesPerSample === 1
    ? state.byteView[offset]
    : state.dataView.getUint16(offset, true);
}

function inverseTransfer(value, transfer) {
  const encoded = Math.max(0, Math.min(1, value));
  if (transfer === "pq") return pqToNits(encoded);
  if (transfer === "hlg") return hlgToLinear(encoded);
  if (transfer === "linear") return encoded;
  if (transfer === "iec61966-2-1") {
    return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
  }
  return encoded < 0.081 ? encoded / 4.5 : ((encoded + 0.099) / 1.099) ** (1 / 0.45);
}

function hlgToLinear(value) {
  const a = 0.17883277;
  const b = 0.28466892;
  const c = 0.55991073;
  return value <= 0.5 ? value * value / 3 : (Math.exp((value - c) / a) + b) / 12;
}

function buildPqLut() {
  const result = new Float32Array(PQ_LUT_SIZE + 1);
  const m1 = 2610 / 16384;
  const m2 = 2523 / 32;
  const c1 = 3424 / 4096;
  const c2 = 2413 / 128;
  const c3 = 2392 / 128;
  for (let index = 0; index <= PQ_LUT_SIZE; index += 1) {
    const signal = index / PQ_LUT_SIZE;
    const power = signal ** (1 / m2);
    const normalized = Math.max(power - c1, 0) / Math.max(c2 - c3 * power, Number.EPSILON);
    result[index] = 10000 * normalized ** (1 / m1);
  }
  return result;
}

function pqToNits(signal) {
  const position = Math.max(0, Math.min(1, signal)) * PQ_LUT_SIZE;
  const low = Math.floor(position);
  const high = Math.min(PQ_LUT_SIZE, low + 1);
  const fraction = position - low;
  return pqToNitsLut[low] + (pqToNitsLut[high] - pqToNitsLut[low]) * fraction;
}
