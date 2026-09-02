import { createWorkerRasterSource } from "./raster-source.js?v=20260901-2";

export function openExrRasterSource(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./exr-worker.js?v=20260902-1", import.meta.url), { type: "module" });
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const onMessage = (event) => {
      const message = event.data || {};
      if (message.id !== 0) return;
      cleanup();
      if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message || "EXR initialization failed."));
        return;
      }
      const result = message.result;
      const preview = {
        width: result.previewWidth,
        height: result.previewHeight,
        pixels: new Float32Array(result.previewPixels)
      };
      const rasterSource = createWorkerRasterSource(worker, {
        width: result.width,
        height: result.height,
        format: "EXR",
        bitDepth: result.bitDepth,
        accessMode: "scanline-streaming",
        directPixel: true,
        initialPreview: preview
      });
      resolve({ ...result, preview, rasterSource });
    };
    const onError = (event) => {
      cleanup();
      worker.terminate();
      reject(new Error(event.message || "EXR worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id: 0, type: "raster-init", file });
  });
}
