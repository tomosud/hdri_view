import assert from "node:assert/strict";
import { createWorkerRasterSource } from "../raster-source.js";

class MockWorker extends EventTarget {
  sent = [];
  postMessage(message) { this.sent.push(message); }
  terminate() {}
  reply(message) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
}
globalThis.Worker = MockWorker;
const worker = new MockWorker();
const source = createWorkerRasterSource(worker, { width: 2262, height: 1824, directPixel: true });
const first = source.getPixel(382, 531);
const target = new Float32Array(4);
const duplicate = source.getPixel(382, 531, target);
assert.equal(worker.sent.length, 1, "Concurrent reads share one request");
worker.reply({ id: worker.sent[0].id, result: { values: [2, 0.5, 4, 1] } });
assert.deepEqual([...await first], [2, 0.5, 4, 1]);
assert.equal(await duplicate, target);
target.fill(0);
// Picker redraw must synchronously receive the completed sample, not another Promise.
const redraw = source.getPixel(382, 531);
assert.ok(redraw instanceof Float32Array);
assert.deepEqual([...redraw], [2, 0.5, 4, 1]);
assert.equal(worker.sent.length, 1);

const failed = source.getPixel(1, 2);
worker.reply({ id: worker.sent.at(-1).id, type: "error", message: "Read failed" });
await assert.rejects(failed, /Read failed/);
const retry = source.getPixel(1, 2);
worker.reply({ id: worker.sent.at(-1).id, result: { values: [1, 2, 3, 1] } });
assert.deepEqual([...await retry], [1, 2, 3, 1]);
source.dispose();
await assert.rejects(source.getPixel(382, 531), /closed/);
console.log("Raster source picker regression tests passed.");
