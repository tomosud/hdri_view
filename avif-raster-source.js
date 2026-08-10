import { createWorkerRasterSource } from "./raster-source.js?v=20260811-2";

const MAX_DECODED_SAMPLE_BYTES = 512 * 1024 * 1024;

export function openAvifRasterSource(file, { onProgress = null, maximumPreviewEdge = 1024 } = {}) {
  if (!(file instanceof Blob)) {
    return Promise.reject(new Error("AVIF decode requires a File or Blob."));
  }
  if (typeof ImageDecoder !== "function") {
    return Promise.reject(new Error("This browser does not expose WebCodecs ImageDecoder."));
  }

  return file.arrayBuffer().then((buffer) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./avif-worker.js?v=20260810-2", import.meta.url));
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
        reject(new Error(message.message || "AVIF exact decode failed."));
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
        format: "AVIF",
        bitDepth: result.bitDepth,
        frameFormat: result.frameFormat,
        primaries: result.primaries,
        transfer: result.transfer,
        matrix: result.matrix,
        fullRange: result.fullRange,
        valueUnit: result.valueUnit,
        initialPreview: preview
      });
      resolve({ ...result, preview, rasterSource });
    };
    const onError = (event) => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
      reject(new Error(event.message || "AVIF exact decoder worker failed."));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({
      id: initId,
      type: "raster-init",
      buffer,
      mimeType: file.type || "image/avif",
      maximumPreviewEdge,
      maximumDecodedSampleBytes: MAX_DECODED_SAMPLE_BYTES
    }, [buffer]);
  }));
}
