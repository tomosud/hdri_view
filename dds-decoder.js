// DDS container adapter. Compression decoding is delegated to vendor/bcdec.
// https://learn.microsoft.com/windows/win32/direct3ddds/dx-graphics-dds-pguide
export function inspectDds(source, fileSize = null) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  if (bytes.length < 128 || u32(0) !== 0x20534444 || u32(4) !== 124 || u32(76) !== 32) {
    throw new Error("Invalid or truncated DDS header.");
  }
  const width = u32(16), height = u32(12);
  if (!width || !height || width > 32768 || height > 32768 || width * height > 32 * 1024 * 1024) {
    throw new Error("DDS dimensions are invalid or exceed the 32-megapixel decode limit.");
  }
  if (u32(24) > 1 || (u32(112) & (0xfe00 | 0x200000))) {
    throw new Error("Only 2D DDS textures are supported (no cubemaps or volumes).");
  }
  if (!(u32(80) & 4)) throw new Error("Uncompressed DDS is not supported; use BC1–BC7 DDS.");
  const fourCC = String.fromCharCode(...bytes.subarray(84, 88));
  let offset = 128, format, signed = false, srgb = false, arraySize = 1;
  if (fourCC === "DX10") {
    if (bytes.length < 148) throw new Error("Truncated DDS DX10 header.");
    offset = 148;
    if (u32(132) !== 3 || !u32(140) || (u32(136) & 4)) {
      throw new Error("Only 2D DDS textures and arrays are supported (no cubemaps).");
    }
    arraySize = u32(140);
    const dxgi = u32(128);
    format = {
      71: 1, 72: 1, 74: 2, 75: 2, 77: 3, 78: 3, 80: 4, 81: 4,
      83: 5, 84: 5, 95: 6, 96: 6, 98: 7, 99: 7
    }[dxgi];
    if (!format) throw new Error(`Unsupported DDS DXGI format ${dxgi}; use BC1–BC7.`);
    srgb = [72, 75, 78, 99].includes(dxgi);
    signed = [81, 84, 96].includes(dxgi);
    if ((u32(144) & 7) === 2) throw new Error("Premultiplied-alpha DDS is not supported.");
  } else {
    format = { DXT1: 1, DXT3: 2, DXT5: 3, ATI1: 4, BC4U: 4, BC4S: 4, ATI2: 5, BC5U: 5, BC5S: 5 }[fourCC];
    signed = fourCC === "BC4S" || fourCC === "BC5S";
    if (!format) throw new Error(`Unsupported DDS FourCC ${fourCC}.`);
  }
  const blockBytes = format === 1 || format === 4 ? 8 : 16;
  const length = Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes;
  const mipCount = Math.max(1, u32(28));
  if (mipCount > 1 + Math.floor(Math.log2(Math.max(width, height)))) throw new Error("Invalid DDS mip count.");
  let layerStride = 0;
  for (let mip = 0; mip < mipCount; mip++) {
    layerStride += Math.ceil(Math.max(1, width >> mip) / 4) * Math.ceil(Math.max(1, height >> mip) / 4) * blockBytes;
  }
  if (offset + layerStride * arraySize > (fileSize ?? bytes.length)) throw new Error("Truncated DDS mip or array pixel data.");
  return { width, height, offset, length, format, signed, srgb, hdr: format === 6, arraySize, mipCount, layerStride };
}

function selectLayer(info, layerIndex) {
  if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= info.arraySize) throw new Error("DDS layer index is out of range.");
  return { ...info, offset: info.offset + layerIndex * info.layerStride, layerIndex };
}

let decoderPromise;
async function openDecoder() {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const response = await fetch(new URL("./vendor/bcdec/bcdec.wasm?v=20260930-1", import.meta.url));
      if (!response.ok) throw new Error(`DDS decoder download failed (${response.status}).`);
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
      return instance.exports;
    })().catch((error) => { decoderPromise = null; throw error; });
  }
  return decoderPromise;
}

// Optional exports argument lets offline tests exercise the very same WASM binary.
export async function decodeDds(source, decoder = null, layerIndex = 0) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const info = selectLayer(inspectDds(bytes), layerIndex);
  return decodePixels(bytes.subarray(info.offset, info.offset + info.length), info, decoder);
}

export async function decodeDdsFile(file, layerIndex = 0, decoder = null) {
  const info = selectLayer(inspectDds(await file.slice(0, 148).arrayBuffer(), file.size), layerIndex);
  const bytes = new Uint8Array(await file.slice(info.offset, info.offset + info.length).arrayBuffer());
  if (bytes.length !== info.length) throw new Error("Truncated DDS layer pixel data.");
  return decodePixels(bytes, info, decoder);
}

async function decodePixels(bytes, info, decoder) {
  const { width, height, length, format, signed, srgb } = info;
  const wasm = decoder || await openDecoder();
  const input = Number(wasm.__heap_base.value);
  const output = Math.ceil((input + length) / 16) * 16;
  const end = output + width * height * 16;
  if (end > wasm.memory.buffer.byteLength) wasm.memory.grow(Math.ceil((end - wasm.memory.buffer.byteLength) / 65536));
  new Uint8Array(wasm.memory.buffer, input, length).set(bytes);
  wasm.decode(input, output, width, height, format, Number(signed));
  const pixels = new Float32Array(wasm.memory.buffer, output, width * height * 4).slice();
  if (srgb) for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) {
    const v = pixels[i + c];
    pixels[i + c] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }
  return { ...info, pixels };
}

export function loadDds(file, layerIndex = 0) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./dds-worker.js?v=20260930-2", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "DDS worker failed."));
    };
    worker.postMessage({ file, layerIndex });
  });
}
