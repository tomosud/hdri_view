import { createWorkerRasterSource } from "./raster-source.js?v=20260811-2";

const DEFAULT_MAX_PIXELS = 4096 * 4096;
const MAX_FULL_RESOLUTION_SAMPLE_BYTES = 256 * 1024 * 1024;

export function inspectJpeg2000(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const container = bytes.length >= 12
    && bytes[4] === 0x6a && bytes[5] === 0x50 && bytes[6] === 0x20 && bytes[7] === 0x20
    ? "JP2"
    : "J2K";
  let siz = -1;
  const searchLimit = Math.min(bytes.length - 40, 1024 * 1024);
  for (let offset = 2; offset < searchLimit; offset += 1) {
    if (bytes[offset] === 0xff && bytes[offset + 1] === 0x51) {
      siz = offset;
      break;
    }
  }
  if (siz < 0) {
    throw new Error("JPEG 2000 SIZ marker was not found.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const segmentLength = view.getUint16(siz + 2);
  if (segmentLength < 41 || siz + 2 + segmentLength > bytes.length) {
    throw new Error("JPEG 2000 SIZ marker is truncated.");
  }
  const width = view.getUint32(siz + 6) - view.getUint32(siz + 14);
  const height = view.getUint32(siz + 10) - view.getUint32(siz + 18);
  const components = view.getUint16(siz + 38);
  if (width < 1 || height < 1 || components < 1 || siz + 40 + components * 3 > bytes.length) {
    throw new Error("JPEG 2000 dimensions or components are invalid.");
  }
  const firstSample = bytes[siz + 40];
  const bitDepth = (firstSample & 0x7f) + 1;
  const signed = Boolean(firstSample & 0x80);
  for (let component = 1; component < components; component += 1) {
    const sample = bytes[siz + 40 + component * 3];
    if ((sample & 0x7f) + 1 !== bitDepth || Boolean(sample & 0x80) !== signed) {
      throw new Error("Mixed JPEG 2000 component bit depths are not supported.");
    }
  }
  return { container, width, height, components, bitDepth, signed };
}

export function decodeJpeg2000(source, { maxPixels = DEFAULT_MAX_PIXELS, onProgress = null } = {}) {
  const buffer = source instanceof ArrayBuffer
    ? source
    : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const info = inspectJpeg2000(buffer);
  let level = 0;
  let width = info.width;
  let height = info.height;
  while (width * height > maxPixels) {
    width = Math.ceil(width / 2);
    height = Math.ceil(height / 2);
    level += 1;
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./jp2-worker.js?v=20260809-2", import.meta.url));
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        onProgress?.(message.progress, message.label);
        return;
      }
      worker.terminate();
      if (message.type === "error") {
        reject(new Error(message.message || "JPEG 2000 decode failed."));
        return;
      }
      if (message.type === "result") {
        resolve({
          ...info,
          width: message.width,
          height: message.height,
          sourceWidth: info.width,
          sourceHeight: info.height,
          downsample: 2 ** level,
          pixels: new Float32Array(message.pixels)
        });
      }
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message || "JPEG 2000 worker failed."));
    });
    worker.postMessage({ type: "decode", buffer, level }, [buffer]);
  });
}

export function openJpeg2000RasterSource(source, { onProgress = null, maxPreviewPixels = 4_194_304 } = {}) {
  const buffer = source instanceof ArrayBuffer
    ? source
    : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const info = inspectJpeg2000(buffer);
  const decodedSampleBytes = info.width * info.height * info.components * (info.bitDepth <= 8 ? 1 : 2);
  if (decodedSampleBytes > MAX_FULL_RESOLUTION_SAMPLE_BYTES) {
    return Promise.reject(new Error(
      `Full-resolution JPEG 2000 needs about ${Math.ceil(decodedSampleBytes / 1048576)} MiB before codec working memory; using wavelet sub-resolution.`
    ));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./jp2-worker.js?v=20260809-3", import.meta.url));
    const initId = 0;
    const onMessage = (event) => {
      const message = event.data || {};
      if (message.id !== initId) return;
      if (message.type === "progress") {
        onProgress?.(message.progress, message.label);
        return;
      }
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message || "JPEG 2000 tiled source initialization failed."));
        return;
      }
      const result = message.result || {};
      const preview = {
        width: result.previewWidth,
        height: result.previewHeight,
        pixels: new Float32Array(result.previewPixels)
      };
      const rasterSource = createWorkerRasterSource(worker, {
        width: result.width,
        height: result.height,
        format: info.container,
        bitDepth: result.bitDepth,
        components: result.components,
        signed: result.signed,
        initialPreview: preview
      });
      resolve({ ...info, ...result, preview, rasterSource });
    };
    const onError = (event) => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
      reject(new Error(event.message || "JPEG 2000 tiled source worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id: initId, type: "raster-init", buffer, maxPreviewPixels }, [buffer]);
  });
}
