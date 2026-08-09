/* global OpenJPEGJS, importScripts */

importScripts("./vendor/openjpeg/openjpegjs_decode.js?v=1.3.0");

let codecPromise = null;
let rasterDecoder = null;
let rasterState = null;

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
    rasterDecoder?.delete?.();
    rasterDecoder = null;
    rasterState = null;
    self.close();
    return;
  }
  if (message.type !== "decode") {
    return;
  }
  let decoder = null;
  try {
    let lastProgress = -1;
    const report = (line) => {
      const match = /Tile (\d+)\/(\d+) has been decoded/.exec(String(line));
      if (!match) {
        return;
      }
      const progress = Math.floor((Number(match[1]) / Number(match[2])) * 100);
      if (progress >= lastProgress + 5 || progress === 100) {
        lastProgress = progress;
        self.postMessage({ type: "progress", progress, label: `JPEG 2000 ${progress}%` });
      }
    };
    codecPromise ||= OpenJPEGJS({ print: report, printErr: report });
    self.postMessage({ type: "progress", progress: 0, label: "Starting JPEG 2000 decode" });
    const codec = await codecPromise;
    const encoded = new Uint8Array(message.buffer);
    decoder = new codec.J2KDecoder();
    decoder.getEncodedBuffer(encoded.length).set(encoded);
    decoder.decodeSubResolution(message.level, 0);

    const frame = decoder.getFrameInfo();
    const size = decoder.calculateSizeAtDecompositionLevel(message.level);
    if (frame.componentCount !== 1 && frame.componentCount !== 3) {
      throw new Error(`Unsupported JPEG 2000 component count: ${frame.componentCount}.`);
    }
    if (frame.bitsPerSample < 1 || frame.bitsPerSample > 16) {
      throw new Error(`Unsupported JPEG 2000 bit depth: ${frame.bitsPerSample}.`);
    }

    const bytes = decoder.getDecodedBuffer();
    const bytesPerSample = frame.bitsPerSample <= 8 ? 1 : 2;
    const expectedSamples = size.width * size.height * frame.componentCount;
    if (bytes.byteLength < expectedSamples * bytesPerSample) {
      throw new Error("JPEG 2000 decoded buffer is truncated.");
    }
    const samples = bytesPerSample === 1
      ? bytes
      : frame.isSigned
        ? new Int16Array(bytes.buffer, bytes.byteOffset, expectedSamples)
        : new Uint16Array(bytes.buffer, bytes.byteOffset, expectedSamples);
    const sampleMax = 2 ** frame.bitsPerSample - 1;
    const signedOffset = frame.isSigned ? 2 ** (frame.bitsPerSample - 1) : 0;
    const pixels = new Float32Array(size.width * size.height * 4);
    const toLinear = new Float32Array(sampleMax + 1);
    for (let sample = 0; sample <= sampleMax; sample += 1) {
      const encodedValue = sample / sampleMax;
      toLinear[sample] = encodedValue <= 0.04045
        ? encodedValue / 12.92
        : ((encodedValue + 0.055) / 1.055) ** 2.4;
    }

    for (let source = 0, target = 0; source < expectedSamples; source += frame.componentCount, target += 4) {
      const first = Math.max(0, Math.min(sampleMax, samples[source] + signedOffset));
      if (frame.componentCount === 1) {
        const value = toLinear[first];
        pixels[target] = value;
        pixels[target + 1] = value;
        pixels[target + 2] = value;
      } else {
        const green = Math.max(0, Math.min(sampleMax, samples[source + 1] + signedOffset));
        const blue = Math.max(0, Math.min(sampleMax, samples[source + 2] + signedOffset));
        pixels[target] = toLinear[first];
        pixels[target + 1] = toLinear[green];
        pixels[target + 2] = toLinear[blue];
      }
      pixels[target + 3] = 1;
    }

    decoder.delete();
    decoder = null;
    self.postMessage({ type: "result", width: size.width, height: size.height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    decoder?.delete?.();
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
});

async function initializeRaster(message) {
  try {
    const report = (line) => {
      const match = /Tile (\d+)\/(\d+) has been decoded/.exec(String(line));
      if (match) {
        const progress = Math.floor(Number(match[1]) / Number(match[2]) * 100);
        self.postMessage({ id: message.id, type: "progress", progress, label: `JPEG 2000 ${progress}%` });
      }
    };
    codecPromise ||= OpenJPEGJS({ print: report, printErr: report });
    const codec = await codecPromise;
    rasterDecoder?.delete?.();
    rasterDecoder = new codec.J2KDecoder();
    const encoded = new Uint8Array(message.buffer);
    rasterDecoder.getEncodedBuffer(encoded.length).set(encoded);
    rasterDecoder.decodeSubResolution(0, 0);
    const frame = rasterDecoder.getFrameInfo();
    const size = rasterDecoder.calculateSizeAtDecompositionLevel(0);
    if (frame.componentCount !== 1 && frame.componentCount !== 3) {
      throw new Error(`Unsupported JPEG 2000 component count: ${frame.componentCount}.`);
    }
    if (frame.bitsPerSample < 1 || frame.bitsPerSample > 16) {
      throw new Error(`Unsupported JPEG 2000 bit depth: ${frame.bitsPerSample}.`);
    }
    const bytes = rasterDecoder.getDecodedBuffer();
    const sampleCount = size.width * size.height * frame.componentCount;
    const bytesPerSample = frame.bitsPerSample <= 8 ? 1 : 2;
    if (bytes.byteLength < sampleCount * bytesPerSample) throw new Error("JPEG 2000 decoded buffer is truncated.");
    const samples = bytesPerSample === 1
      ? bytes
      : frame.isSigned
        ? new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount)
        : new Uint16Array(bytes.buffer, bytes.byteOffset, sampleCount);
    rasterState = {
      width: size.width,
      height: size.height,
      components: frame.componentCount,
      bitDepth: frame.bitsPerSample,
      signed: frame.isSigned,
      sampleMax: 2 ** frame.bitsPerSample - 1,
      signedOffset: frame.isSigned ? 2 ** (frame.bitsPerSample - 1) : 0,
      samples,
      preview: null
    };
    rasterState.preview = buildJp2Preview(message.maxPreviewPixels || 4_194_304);
    const previewTransfer = rasterState.preview.pixels.slice();
    self.postMessage({
      id: message.id,
      type: "raster-ready",
      result: {
        width: rasterState.width,
        height: rasterState.height,
        components: rasterState.components,
        bitDepth: rasterState.bitDepth,
        signed: rasterState.signed,
        previewWidth: rasterState.preview.width,
        previewHeight: rasterState.preview.height,
        previewPixels: previewTransfer.buffer
      }
    }, [previewTransfer.buffer]);
  } catch (error) {
    rasterDecoder?.delete?.();
    rasterDecoder = null;
    rasterState = null;
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
}

function jp2Pixel(x, y) {
  const state = rasterState;
  const source = (y * state.width + x) * state.components;
  const normalized = (channel) => Math.max(0, Math.min(state.sampleMax, state.samples[source + channel] + state.signedOffset)) / state.sampleMax;
  const first = srgbToLinear(normalized(0));
  return state.components === 1
    ? [first, first, first, 1]
    : [first, srgbToLinear(normalized(1)), srgbToLinear(normalized(2)), 1];
}

function buildJp2Preview(maxPixels) {
  const downsample = Math.max(1, Math.ceil(Math.sqrt(rasterState.width * rasterState.height / maxPixels)));
  const width = Math.ceil(rasterState.width / downsample);
  const height = Math.ceil(rasterState.height / downsample);
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(rasterState.height - 1, y * downsample + Math.floor(downsample / 2));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(rasterState.width - 1, x * downsample + Math.floor(downsample / 2));
      pixels.set(jp2Pixel(sourceX, sourceY), (y * width + x) * 4);
    }
  }
  return { width, height, downsample, pixels };
}

function handleRasterRequest(message) {
  if (!rasterState) {
    self.postMessage({ id: message.id, type: "error", message: "JPEG 2000 raster source is not initialized." });
    return;
  }
  try {
    let result;
    if (message.operation === "tile") result = buildJp2Tile(message);
    else if (message.operation === "region") result = buildJp2Region(message.rect);
    else if (message.operation === "preview") {
      const copy = rasterState.preview.pixels.slice();
      result = { width: rasterState.preview.width, height: rasterState.preview.height, pixels: copy.buffer };
    } else throw new Error(`Unknown JPEG 2000 raster operation: ${message.operation}.`);
    self.postMessage({ id: message.id, type: "result", result }, [result.pixels]);
  } catch (error) {
    self.postMessage({ id: message.id, type: "error", message: error?.message || String(error) });
  }
}

function buildJp2Tile({ level, tileX, tileY, gutter = 1 }) {
  const tileSize = 512;
  const factor = 2 ** level;
  const levelWidth = Math.ceil(rasterState.width / factor);
  const levelHeight = Math.ceil(rasterState.height / factor);
  const levelX = tileX * tileSize;
  const levelY = tileY * tileSize;
  const width = Math.min(tileSize, levelWidth - levelX);
  const height = Math.min(tileSize, levelHeight - levelY);
  if (width < 1 || height < 1) throw new Error("JPEG 2000 tile is outside the image.");
  const stride = width + gutter * 2;
  const pixels = new Float32Array(stride * (height + gutter * 2) * 4);
  for (let y = -gutter; y < height + gutter; y += 1) {
    const sampleY = Math.max(0, Math.min(levelHeight - 1, levelY + y));
    for (let x = -gutter; x < width + gutter; x += 1) {
      const sampleX = Math.max(0, Math.min(levelWidth - 1, levelX + x));
      pixels.set(averageJp2Pixel(sampleX * factor, sampleY * factor, factor), ((y + gutter) * stride + x + gutter) * 4);
    }
  }
  return { level, tileX, tileY, gutter, width, height, stride, pixels: pixels.buffer };
}

function averageJp2Pixel(sourceX, sourceY, factor) {
  const preview = rasterState.preview;
  if (factor >= preview.downsample) {
    const px = Math.min(preview.width - 1, Math.floor((sourceX + factor / 2) / preview.downsample));
    const py = Math.min(preview.height - 1, Math.floor((sourceY + factor / 2) / preview.downsample));
    const offset = (py * preview.width + px) * 4;
    return preview.pixels.subarray(offset, offset + 4);
  }
  const right = Math.min(rasterState.width, sourceX + factor);
  const bottom = Math.min(rasterState.height, sourceY + factor);
  let red = 0, green = 0, blue = 0, count = 0;
  for (let y = sourceY; y < bottom; y += 1) for (let x = sourceX; x < right; x += 1) {
    const rgba = jp2Pixel(x, y);
    red += rgba[0]; green += rgba[1]; blue += rgba[2]; count += 1;
  }
  const scale = count ? 1 / count : 0;
  return [red * scale, green * scale, blue * scale, 1];
}

function buildJp2Region(rect) {
  const pixels = new Float32Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) for (let x = 0; x < rect.width; x += 1) {
    pixels.set(jp2Pixel(rect.x + x, rect.y + y), (y * rect.width + x) * 4);
  }
  return { width: rect.width, height: rect.height, pixels: pixels.buffer };
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
