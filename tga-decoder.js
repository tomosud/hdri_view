// Truevision TGA decoder (types 1/2/3 and RLE 9/10/11, 8/15/16/24/32-bit).
// Output is RGBA Float32 with sRGB colour linearized, matching the exact PNG path.
const MAX_PIXELS = 32 * 1024 * 1024;

export function inspectTga(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < 18) throw new Error("Truncated TGA header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0], colorMapType = bytes[1], imageType = bytes[2];
  const mapFirst = view.getUint16(3, true), mapLength = view.getUint16(5, true), mapDepth = bytes[7];
  const width = view.getUint16(12, true), height = view.getUint16(14, true);
  const depth = bytes[16], descriptor = bytes[17];
  const kind = imageType & 7;
  if (![1, 2, 3].includes(kind) || (imageType & ~0x0b) !== 0) throw new Error(`Unsupported TGA image type ${imageType}.`);
  if (!width || !height || width * height > MAX_PIXELS) throw new Error("TGA dimensions are invalid or exceed the 32-megapixel decode limit.");
  if (kind === 1 && (colorMapType !== 1 || ![8, 16].includes(depth) || ![15, 16, 24, 32].includes(mapDepth))) {
    throw new Error("Unsupported color-mapped TGA.");
  }
  if (kind === 2 && ![15, 16, 24, 32].includes(depth)) throw new Error(`Unsupported TGA true-color depth ${depth}.`);
  if (kind === 3 && ![8, 16].includes(depth)) throw new Error(`Unsupported TGA grayscale depth ${depth}.`);
  const mapOffset = 18 + idLength;
  const mapBytes = colorMapType === 1 ? mapLength * Math.ceil(mapDepth / 8) : 0;
  return {
    width, height, depth, kind, rle: (imageType & 8) !== 0,
    alphaBits: descriptor & 15, right: (descriptor & 0x10) !== 0, top: (descriptor & 0x20) !== 0,
    mapOffset, mapFirst, mapLength, mapDepth, offset: mapOffset + mapBytes
  };
}

// TGA 2.0 footer: the extension area's attribute type tells whether alpha is meaningful.
function alphaAttribute(bytes) {
  if (bytes.length < 26 + 18) return null;
  const tail = String.fromCharCode(...bytes.subarray(bytes.length - 18, bytes.length - 1));
  if (tail !== "TRUEVISION-XFILE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ext = view.getUint32(bytes.length - 26, true);
  if (!ext || ext + 495 > bytes.length - 26) return null;
  return bytes[ext + 494];
}

export function decodeTga(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const info = inspectTga(bytes);
  const { width, height, depth, kind, rle } = info;
  const bpp = Math.ceil(depth / 8);
  const count = width * height;

  // Raw pixel stream in file order (RLE expanded).
  let raw;
  if (rle) {
    raw = new Uint8Array(count * bpp);
    let src = info.offset, dst = 0;
    while (dst < raw.length) {
      if (src >= bytes.length) throw new Error("Truncated TGA RLE data.");
      const header = bytes[src++];
      const n = ((header & 0x7f) + 1) * bpp;
      if (dst + n > raw.length) throw new Error("Corrupt TGA RLE packet.");
      if (header & 0x80) {
        if (src + bpp > bytes.length) throw new Error("Truncated TGA RLE data.");
        for (let i = 0; i < n; i += bpp) raw.set(bytes.subarray(src, src + bpp), dst + i);
        src += bpp;
      } else {
        if (src + n > bytes.length) throw new Error("Truncated TGA RLE data.");
        raw.set(bytes.subarray(src, src + n), dst);
        src += n;
      }
      dst += n;
    }
  } else {
    if (info.offset + count * bpp > bytes.length) throw new Error("Truncated TGA pixel data.");
    raw = bytes.subarray(info.offset, info.offset + count * bpp);
  }

  // Decode into 8-bit RGBA in file order.
  const rgba = new Uint8Array(count * 4);
  const unpack = (src, srcDepth, out, o) => {
    if (srcDepth === 32 || srcDepth === 24) {
      out[o] = src[2]; out[o + 1] = src[1]; out[o + 2] = src[0];
      out[o + 3] = srcDepth === 32 ? src[3] : 255;
    } else {
      const v = src[0] | (src[1] << 8);
      out[o] = ((v >> 10) & 31) * 255 / 31 + 0.5 | 0;
      out[o + 1] = ((v >> 5) & 31) * 255 / 31 + 0.5 | 0;
      out[o + 2] = (v & 31) * 255 / 31 + 0.5 | 0;
      out[o + 3] = srcDepth === 16 && (v & 0x8000) ? 255 : (srcDepth === 16 ? 0 : 255);
    }
  };
  let pixelDepth = depth;
  if (kind === 1) {
    const entry = Math.ceil(info.mapDepth / 8);
    if (info.mapOffset + info.mapLength * entry > bytes.length) throw new Error("Truncated TGA color map.");
    const palette = new Uint8Array(info.mapLength * 4);
    for (let i = 0; i < info.mapLength; i++) {
      const at = info.mapOffset + i * entry;
      unpack(bytes.subarray(at, at + entry), info.mapDepth, palette, i * 4);
    }
    for (let i = 0; i < count; i++) {
      const index = (bpp === 2 ? raw[i * 2] | (raw[i * 2 + 1] << 8) : raw[i]) - info.mapFirst;
      if (index < 0 || index >= info.mapLength) throw new Error("TGA color index out of range.");
      rgba.set(palette.subarray(index * 4, index * 4 + 4), i * 4);
    }
    pixelDepth = info.mapDepth;
  } else if (kind === 3) {
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      if (depth === 8) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = raw[i]; rgba[o + 3] = 255;
      } else {
        // 16-bit gray in TGA is 8-bit gray + 8-bit alpha.
        rgba[o] = rgba[o + 1] = rgba[o + 2] = raw[i * 2]; rgba[o + 3] = raw[i * 2 + 1];
      }
    }
  } else {
    for (let i = 0; i < count; i++) unpack(raw.subarray(i * bpp, i * bpp + bpp), depth, rgba, i * 4);
  }

  // Alpha handling: 32-bit / 16-bit / gray+alpha carry alpha unless the descriptor says 0 bits
  // and the TGA 2.0 extension marks it as undefined (attribute 0/1/2).
  const hasAlphaChannel = pixelDepth === 32 || pixelDepth === 16 || (kind === 3 && depth === 16);
  const attr = alphaAttribute(bytes);
  let alpha = hasAlphaChannel;
  if (hasAlphaChannel && attr !== null && attr <= 2) alpha = false;
  if (hasAlphaChannel && info.alphaBits === 0 && attr === null && pixelDepth === 16) alpha = false;

  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const c = v / 255;
    lut[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  const pixels = new Float32Array(count * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = info.top ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = (srcRow * width + (info.right ? width - 1 - x : x)) * 4;
      const d = (y * width + x) * 4;
      pixels[d] = lut[rgba[s]];
      pixels[d + 1] = lut[rgba[s + 1]];
      pixels[d + 2] = lut[rgba[s + 2]];
      pixels[d + 3] = alpha ? rgba[s + 3] / 255 : 1;
    }
  }
  return {
    width, height, pixels, alpha, rle,
    depth: pixelDepth, gray: kind === 3, colorMapped: kind === 1
  };
}

export function loadTga(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./tga-worker.js?v=20261020-1", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "TGA worker failed."));
    };
    worker.postMessage({ file });
  });
}
