export function isTiffFile(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  return bytes.length >= 4 && (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) ||
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2b && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2b)
  );
}

export function decodeTiff(source, { onProgress = null } = {}) {
  const buffer = source instanceof ArrayBuffer
    ? source
    : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  if (!isTiffFile(buffer)) {
    return Promise.reject(new Error("Not a TIFF file."));
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./tiff-worker.js?v=20260809-2", import.meta.url));
    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "progress") {
        onProgress?.(message.progress, message.label);
        return;
      }
      worker.terminate();
      if (message.type === "error") {
        reject(new Error(message.message || "TIFF decode failed."));
        return;
      }
      if (message.type === "result") {
        resolve({
          width: message.width,
          height: message.height,
          pixels: new Float32Array(message.pixels),
          bitDepth: message.bitDepth,
          bitDepthLabel: message.bitDepthLabel,
          channels: message.channels,
          compression: message.compression,
          sampleFormat: message.sampleFormat
        });
      }
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message || "TIFF worker failed."));
    });
    worker.postMessage({ type: "decode", buffer }, [buffer]);
  });
}
