import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const panel = () => ({
  classList: { remove() {} },
  style: { removeProperty() {} }
});
const context = vm.createContext({
  viewport: { clientWidth: 960, clientHeight: 600 },
  workspaceView: { scale: 1, panX: 0, panY: 0 },
  minWindowWidth: 220, maxWindowWidth: 4096,
  minWindowHeight: 160, maxWindowHeight: 4096,
  workspaceWorldMin: -16384, workspaceWorldMax: 16384,
  clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  inspector: panel(), pickerPanel: panel(), selectionGraphPanel: panel(), glslPanel: panel(),
  images: [], fileHint: {},
  applyWorkspaceTransform() {}, applyWindowGeometry() {},
  ensureFloatingPanelAccessible() {}, updateViewState() {},
  requestRender() {}, requestSelectionGraphDraw() {}, scheduleSessionSave() {}
});
for (const name of ["viewportPointToWorld", "constrainImageWindow", "ensureImageWindowAccessible", "resetFloatingPanelLayout"]) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}\n", start) + 2;
  assert.ok(start >= 0 && end > start, name);
  vm.runInContext(source.slice(start, end), context);
}

function checkVisible(image) {
  const view = context.workspaceView;
  const x = image.window.x * view.scale + view.panX;
  const y = image.window.y * view.scale + view.panY;
  assert.ok(x >= 0 && x + 72 * view.scale <= context.viewport.clientWidth, "Draggable title width stays visible");
  assert.ok(y >= 0 && y + 28 * view.scale <= context.viewport.clientHeight, "Title bar stays below the toolbar");
}

// Top-edge drops, long cascades, and copies of offscreen nodes at different zooms.
for (const scale of [0.25, 1, 2]) {
  Object.assign(context.workspaceView, { scale, panX: 200, panY: -160 });
  for (const [x, y] of [[450, -18], [12000, 12000], [-12000, -12000]]) {
    const image = { window: { x, y, width: 320, height: 260 } };
    context.ensureImageWindowAccessible(image);
    checkVisible(image);
  }
}

// Reset recovers saved, offscreen windows and an oversized window on a small screen.
context.viewport.clientWidth = 360;
context.viewport.clientHeight = 240;
context.images.push(...Array.from({ length: 20 }, () => ({
  window: { x: 12000, y: -9000, width: 720, height: 560 }
})));
context.resetFloatingPanelLayout();
assert.equal(context.workspaceView.scale, 1);
assert.equal(context.workspaceView.panX, 0);
assert.equal(context.workspaceView.panY, 0);
context.images.forEach(checkVisible);
assert.equal(context.images.length, 20);
console.log("Window placement and reset regression checks passed.");
