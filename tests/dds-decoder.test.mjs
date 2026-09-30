// node tests/dds-decoder.test.mjs [sample-directory ...]
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { decodeDds, decodeDdsFile, inspectDds } from "../dds-decoder.js";

const { instance } = await WebAssembly.instantiate(await readFile(new URL("../vendor/bcdec/bcdec.wasm", import.meta.url)));
const decode = (bytes) => decodeDds(bytes, instance.exports);
const near = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function dds(dxgi, block, width = 4, height = 4) {
  const bytes = new Uint8Array(148 + block.length);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, 0x20534444], [4, 124], [12, height], [16, width], [76, 32], [80, 4], [84, 0x30315844], [128, dxgi], [132, 3], [140, 1]]) view.setUint32(offset, value, true);
  bytes.set(block, 148);
  return bytes;
}
const red = [0, 248, 0, 0, 0, 0, 0, 0];
let decoded = await decode(dds(71, red));
assert.deepEqual([...decoded.pixels.slice(0, 4)], [1, 0, 0, 1]);
const transparent = await decode(dds(71, [0, 0, 255, 255, 255, 255, 255, 255]));
assert.deepEqual([...transparent.pixels.slice(0, 4)], [0, 0, 0, 0]);
decoded = await decode(dds(74, [0, 0, 0, 0, 255, 255, 255, 255, ...red]));
assert.equal(decoded.pixels[3], 0);
assert.equal(decoded.pixels[8 * 4 + 3], 1);
// BC3 alpha indices crossing byte and 32-bit boundaries.
let indices = 0n;
for (let i = 0; i < 16; i++) indices |= BigInt(i % 8) << BigInt(i * 3);
const alpha = [255, 0, ...Array.from({ length: 6 }, (_, i) => Number((indices >> BigInt(i * 8)) & 255n))];
decoded = await decode(dds(77, [...alpha, ...red]));
for (let i = 0; i < 16; i++) near(decoded.pixels[i * 4 + 3], [255, 0, 218, 182, 145, 109, 72, 36][i % 8] / 255);
decoded = await decode(dds(84, [129, 127, 0, 0, 0, 0, 0, 0, 127, 129, 0, 0, 0, 0, 0, 0]));
assert.deepEqual([...decoded.pixels.slice(0, 4)], [-1, 1, 0, 1]);
// BC6H mode 11: six explicit 10-bit endpoints, all indices zero.
function bc6Constant(endpoint) {
  let bits = 3n;
  for (let i = 0; i < 6; i++) bits |= BigInt(endpoint) << BigInt(5 + i * 10);
  return Array.from({ length: 16 }, (_, i) => Number((bits >> BigInt(i * 8)) & 255n));
}
for (const [dxgi, endpoint, expected] of [[95, 1023, 65504], [96, 511, 65504]]) {
  decoded = await decode(dds(dxgi, bc6Constant(endpoint)));
  assert.equal(decoded.hdr, true);
  assert.deepEqual([...decoded.pixels.slice(0, 4)], [expected, expected, expected, 1]);
}
decoded = await decode(dds(96, bc6Constant(513)));
assert.deepEqual([...decoded.pixels.slice(0, 4)], [-65504, -65504, -65504, 1]);
// BC7 mode 6: all endpoints and p-bits set gives opaque white.
let bc7bits = 64n;
for (let i = 7; i < 65; i++) bc7bits |= 1n << BigInt(i);
decoded = await decode(dds(98, Array.from({ length: 16 }, (_, i) => Number((bc7bits >> BigInt(i * 8)) & 255n))));
assert.deepEqual([...decoded.pixels.slice(0, 4)], [1, 1, 1, 1]);
const gray = [16, 132, 0, 0, 0, 0, 0, 0];
const linear = await decode(dds(71, gray));
const srgb = await decode(dds(72, gray));
near(srgb.pixels[0], ((linear.pixels[0] + 0.055) / 1.055) ** 2.4);
assert.equal(srgb.pixels[3], 1);
// Partial edge blocks, mip 0, and an unaligned typed-array input.
decoded = await decode(dds(71, [...red, ...red], 5, 3));
assert.equal(decoded.pixels.length, 60);
assert.deepEqual([...decoded.pixels.slice(-4)], [1, 0, 0, 1]);
const offsetBytes = new Uint8Array(1 + 156);
offsetBytes.set(dds(71, red), 1);
assert.equal((await decode(offsetBytes.subarray(1))).pixels[0], 1);
const legacy = new Uint8Array(136);
legacy.set(dds(71, red).subarray(0, 128));
new DataView(legacy.buffer).setUint32(84, 0x31545844, true);
legacy.set(red, 128);
assert.equal((await decode(legacy)).pixels[0], 1);
// Each array element stores its whole mip chain before the next element.
const blue = [31, 0, 0, 0, 0, 0, 0, 0];
const array = dds(71, [...red, ...gray, ...blue, ...gray]);
const arrayView = new DataView(array.buffer);
arrayView.setUint32(28, 2, true);
arrayView.setUint32(140, 2, true);
assert.equal(inspectDds(array).layerStride, 16);
assert.deepEqual([...(await decodeDds(array, instance.exports, 1)).pixels.slice(0, 4)], [0, 0, 1, 1]);
const slicedReads = [];
const file = new Blob([array]);
const slicedFile = { size: file.size, slice(start, end) { slicedReads.push([start, end]); return file.slice(start, end); } };
assert.deepEqual([...(await decodeDdsFile(slicedFile, 1, instance.exports)).pixels.slice(0, 4)], [0, 0, 1, 1]);
assert.deepEqual(slicedReads, [[0, 148], [164, 172]]);
await assert.rejects(decodeDds(array, instance.exports, 2), /out of range/);
assert.throws(() => inspectDds(array.subarray(0, array.length - 1)), /Truncated/);
const invalidMips = array.slice();
new DataView(invalidMips.buffer).setUint32(28, 4, true);
assert.throws(() => inspectDds(invalidMips), /mip count/);
assert.throws(() => inspectDds(new Uint8Array(120)), /header/);
assert.throws(() => inspectDds(dds(71, [])), /Truncated/);
assert.throws(() => inspectDds(dds(28, red)), /Unsupported/);
for (const [offset, value] of [[132, 4], [140, 2], [136, 4], [112, 0x200], [144, 2], [16, 0], [16, 32769]]) {
  const invalid = dds(71, red);
  new DataView(invalid.buffer).setUint32(offset, value, true);
  assert.throws(() => inspectDds(invalid));
}
console.log("DDS fixtures: BC1–BC7, BC6H ±65504, sRGB, alpha, partial blocks, malformed headers passed.");

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.dds$/i.test(entry.name)) {
      const start = performance.now();
      const bytes = await readFile(path);
      const info = inspectDds(bytes);
      const file = new Blob([bytes]);
      for (let layer = 0; layer < info.arraySize; layer++) {
        const image = await decodeDdsFile(file, layer, instance.exports);
        let minimum = Infinity, maximum = -Infinity;
        for (const value of image.pixels) {
          assert.ok(Number.isFinite(value));
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
        console.log(`${entry.name} layer ${layer}: BC${image.format}, ${image.width}x${image.height}, range ${minimum}..${maximum}, ${Math.round(performance.now() - start)}ms`);
      }
    }
  }
}
for (const directory of process.argv.slice(2)) await scan(directory);
