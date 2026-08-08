const SHARE_PREFIX = "#glsl=";
const SHARE_VERSION = 1;
const MAX_ENCODED_LENGTH = 256 * 1024;
const MAX_CODE_LENGTH = 128 * 1024;
const MAX_PIXELS = 8_388_608;

function validateShareState(value) {
  const width = Number(value?.w);
  const height = Number(value?.h);
  const code = value?.c;
  if (value?.v !== SHARE_VERSION || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width * height > MAX_PIXELS || typeof code !== "string") {
    throw new Error("Invalid shared GLSL settings.");
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error("Shared GLSL code is too long.");
  }
  return { width, height, code };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(encoded) {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > MAX_ENCODED_LENGTH) {
    throw new Error("Invalid shared GLSL URL.");
  }
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeGlslShareHash({ width, height, code }) {
  const state = validateShareState({ v: SHARE_VERSION, w: width, h: height, c: code });
  const json = JSON.stringify({ v: SHARE_VERSION, w: state.width, h: state.height, c: state.code });
  const encoded = bytesToBase64Url(new TextEncoder().encode(json));
  if (encoded.length > MAX_ENCODED_LENGTH) {
    throw new Error("Shared GLSL URL is too long.");
  }
  return `${SHARE_PREFIX}${encoded}`;
}

export function decodeGlslShareHash(hash) {
  if (!hash.startsWith(SHARE_PREFIX)) {
    return null;
  }
  const encoded = hash.slice(SHARE_PREFIX.length);
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded));
    return validateShareState(JSON.parse(json));
  } catch (error) {
    throw new Error(`Could not read shared GLSL URL: ${error.message}`);
  }
}
