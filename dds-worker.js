import { decodeDdsFile } from "./dds-decoder.js?v=20260930-2";

self.onmessage = async ({ data: { file, layerIndex } }) => {
  try {
    const decoded = await decodeDdsFile(file, layerIndex);
    self.postMessage(decoded, [decoded.pixels.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || "DDS decode failed." });
  }
};
