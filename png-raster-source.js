import { createWorkerRasterSource } from "./raster-source.js?v=20260809-6";

export function canOpenPngAsTiles(headerBytes, minimumPixels = 4096 * 4096) {
  const bytes = headerBytes instanceof Uint8Array ? headerBytes : new Uint8Array(headerBytes);
  if (bytes.length < 29) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  return width * height > minimumPixels
    && interlace === 0
    && [8, 16].includes(bitDepth)
    && [0, 2, 4, 6].includes(colorType);
}

export function openPngRasterSource(file, { onProgress = null, maxPreviewPixels = 4_194_304 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./png-tile-worker.js?v=20260809-1", import.meta.url));
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
        reject(new Error(message.message || "PNG tile source initialization failed."));
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
        format: "PNG",
        bitDepth: result.bitDepth,
        colorType: result.colorType,
        hasAlpha: result.hasAlpha,
        initialPreview: preview
      });
      resolve({ ...result, preview, rasterSource });
    };
    const onError = (event) => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
      reject(new Error(event.message || "PNG tile source worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id: initId, type: "raster-init", file, maxPreviewPixels });
  });
}
