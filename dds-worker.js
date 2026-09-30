import { decodeDds } from "./dds-decoder.js?v=20260930-1";

self.onmessage = async ({ data: file }) => {
  try {
    const decoded = await decodeDds(await file.arrayBuffer());
    self.postMessage(decoded, [decoded.pixels.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || "DDS decode failed." });
  }
};
