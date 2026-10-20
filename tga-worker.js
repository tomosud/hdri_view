import { decodeTga } from "./tga-decoder.js?v=20261020-1";

self.onmessage = async ({ data: { file } }) => {
  try {
    const decoded = decodeTga(new Uint8Array(await file.arrayBuffer()));
    self.postMessage(decoded, [decoded.pixels.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || "TGA decode failed." });
  }
};
