import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { decodePng, isPngFile, pngTypeLabel } from "./png-decoder.js?v=20260808-2";

const fileInput = document.querySelector("#fileInput");
const fileHint = document.querySelector("#fileHint");
const pickerModeButton = document.querySelector("#pickerModeButton");
const viewport = document.querySelector("#viewport");
const selectionGraphPanel = document.querySelector("#selectionGraphPanel");
const selectionGraphCanvas = document.querySelector("#selectionGraphCanvas");
const selectionGraphLabel = document.querySelector("#selectionGraphLabel");
const selectionGraphResize = document.querySelector("#selectionGraphResize");
const logDisplayButton = document.querySelector("#logDisplayButton");
const windowLayer = document.querySelector("#windowLayer");
const dropPrompt = document.querySelector("#dropPrompt");
const inspector = document.querySelector("#inspector");
const emptySettings = document.querySelector("#emptySettings");
const settingsForm = document.querySelector("#settingsForm");
const zoomSelect = document.querySelector("#zoomSelect");
const filterSelect = document.querySelector("#filterSelect");
const autoLevelInput = document.querySelector("#autoLevelInput");
const brightnessInput = document.querySelector("#brightnessInput");
const brightnessReset = document.querySelector("#brightnessReset");
const brightnessHalf = document.querySelector("#brightnessHalf");
const brightnessDouble = document.querySelector("#brightnessDouble");
const channelButtons = document.querySelector("#channelButtons");
const saveFormatSelect = document.querySelector("#saveFormatSelect");
const saveImageButton = document.querySelector("#saveImageButton");
const metaName = document.querySelector("#metaName");
const metaSize = document.querySelector("#metaSize");
const metaType = document.querySelector("#metaType");
const metaRange = document.querySelector("#metaRange");
const pixelPosition = document.querySelector("#pixelPosition");
const linearValue = document.querySelector("#linearValue");
const srgbValue = document.querySelector("#srgbValue");
const viewState = document.querySelector("#viewState");
const pickerValueMode = document.querySelector("#pickerValueMode");
const pickerCopyMode = document.querySelector("#pickerCopyMode");
const pickerRows = document.querySelector("#pickerRows");
const pickerCopyText = document.querySelector("#pickerCopyText");
const copyPickersButton = document.querySelector("#copyPickersButton");
const clearPickersButton = document.querySelector("#clearPickersButton");
const pickerPanel = document.querySelector("#pickerPanel");
const pickersTabButton = document.querySelector("#pickersTabButton");
const selectionTabButton = document.querySelector("#selectionTabButton");
const pickersTabContent = document.querySelector("#pickersTabContent");
const selectionTabContent = document.querySelector("#selectionTabContent");
const selectionSummary = document.querySelector("#selectionSummary");
const selectionMatrixText = document.querySelector("#selectionMatrixText");
const copySelectionMatrixButton = document.querySelector("#copySelectionMatrixButton");
const downloadSelectionCsvButton = document.querySelector("#downloadSelectionCsvButton");

const images = [];
const minWindowWidth = 220;
const minWindowHeight = 160;
const minGraphWidth = 180;
const minGraphHeight = 140;
const maxPickers = 20;
const selectionMatrixPreviewRows = 8;
const selectionMatrixPreviewColumns = 12;
const sessionDbName = "hdri-value-viewer";
const sessionDbVersion = 1;
const sessionStoreName = "session";
const sessionKey = "current";
const pickerColors = [
  "#ff365e", "#35d0ff", "#ffe156", "#69f28d", "#c77dff",
  "#ff9f1c", "#2ec4b6", "#f15bb5", "#b8f35a", "#4d96ff",
  "#ff6b6b", "#9bf6ff", "#fdffb6", "#caffbf", "#bdb2ff",
  "#ffc6ff", "#00f5d4", "#f7b801", "#a1ff0a", "#ff70a6"
];

let selectedId = null;
let nextId = 1;
let topZ = 10;
let activeDrag = null;
let rafPending = false;
let graphRafPending = false;
let pickerMode = false;
let internalClipboard = null;
let topUiZ = 100000;
let activePanelTab = "pickers";
let saveSessionTimer = null;
let restoringSession = false;
const graphView = {
  yaw: -0.72,
  pitch: 0.92
};
let logDisplayMode = false;
const graphCtx = selectionGraphCanvas.getContext("2d");
const selectionDetailsCache = new WeakMap();
let selectionDetailsTimer = null;
let selectionCopyFrame = null;
let selectionWorker = null;
let selectionJobId = 0;
let selectionDetailsInFlight = null;
let selectionMatrixCopyFrame = null;
let selectionMatrixCopyWorker = null;
let selectionMatrixCopyJobId = 0;
let selectionMatrixCopyInFlight = null;

fileInput.addEventListener("click", (event) => {
  if (!window.showOpenFilePicker) {
    return;
  }
  event.preventDefault();
  void openFilesWithPicker();
});

fileInput.addEventListener("change", () => {
  void openFiles(fileInput.files);
  fileInput.value = "";
});

pickerModeButton.addEventListener("click", () => {
  setPickerMode(!pickerMode);
});

pickerValueMode.addEventListener("change", () => {
  updatePickerPanel();
  updateSelectionPanel();
  scheduleSessionSave();
});

pickerCopyMode.addEventListener("change", () => {
  updatePickerPanel();
  scheduleSessionSave();
});

pickersTabButton.addEventListener("click", () => setPanelTab("pickers"));
selectionTabButton.addEventListener("click", () => setPanelTab("selection"));

copyPickersButton.addEventListener("click", async () => {
  pickerCopyText.select();
  const text = pickerCopyText.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.execCommand("copy");
  }
});

copySelectionMatrixButton.addEventListener("click", () => {
  void copyFullSelectionMatrix();
});

logDisplayButton.addEventListener("click", () => {
  logDisplayMode = !logDisplayMode;
  updateLogDisplayButton();
  for (const image of images) {
    image.displayDirty = true;
  }
  requestRender();
  requestSelectionGraphDraw();
  scheduleSessionSave();
});

selectionSummary.addEventListener("pointerdown", (event) => event.stopPropagation());
selectionSummary.addEventListener("copy", (event) => event.stopPropagation());

downloadSelectionCsvButton.addEventListener("click", () => {
  const image = currentImage();
  if (!image?.selection) {
    return;
  }
  const csv = selectionCsvText(image, image.selection);
  downloadBytes(new TextEncoder().encode(csv), `${stripExtension(image.name)}_selection.csv`, "text/csv;charset=utf-8");
});

clearPickersButton.addEventListener("click", () => {
  if (activePanelTab !== "pickers") {
    return;
  }
  if (allPickers().length === 0) {
    return;
  }
  if (confirm("Clear all pickers?")) {
    for (const image of images) {
      image.pickers = [];
    }
    updatePickerPanel();
    requestRender();
    scheduleSessionSave();
  }
});

saveImageButton.addEventListener("click", () => {
  const image = currentImage();
  if (image) {
    saveImage(image, saveFormatSelect.value);
  }
});

selectionGraphResize.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const rect = selectionGraphPanel.getBoundingClientRect();
  selectionGraphPanel.style.zIndex = String(++topUiZ);
  activeDrag = {
    kind: "graphResize",
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height
  };
  selectionGraphResize.setPointerCapture(event.pointerId);
});

selectionGraphCanvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  selectionGraphPanel.style.zIndex = String(++topUiZ);
  activeDrag = {
    kind: "graphRotate",
    startX: event.clientX,
    startY: event.clientY,
    yaw: graphView.yaw,
    pitch: graphView.pitch
  };
  selectionGraphCanvas.setPointerCapture(event.pointerId);
});

viewport.addEventListener("dragenter", (event) => {
  event.preventDefault();
  viewport.classList.add("drag-over");
});

viewport.addEventListener("dragover", (event) => {
  event.preventDefault();
  viewport.classList.add("drag-over");
});

viewport.addEventListener("dragleave", (event) => {
  if (!viewport.contains(event.relatedTarget)) {
    viewport.classList.remove("drag-over");
  }
});

viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  viewport.classList.remove("drag-over");
  const rect = viewport.getBoundingClientRect();
  void openDroppedFiles(event, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  });
});

viewport.addEventListener("pointerdown", (event) => {
  if (event.target === viewport || event.target === windowLayer) {
    clearActiveSelection();
  }
});

document.addEventListener("paste", (event) => {
  if (shouldKeepNativeClipboardEvent(event)) {
    return;
  }
  const clipboardData = event.clipboardData;
  const files = clipboardImageFiles(clipboardData);
  if (files.length > 0) {
    event.preventDefault();
    void openFiles(files, null, { embedded: true });
    return;
  }
  if (internalClipboard) {
    event.preventDefault();
    pasteInternalClipboard();
  }
});

document.addEventListener("copy", (event) => {
  if (shouldKeepNativeClipboardEvent(event) || hasNativeTextSelection()) {
    return;
  }
  const image = currentImage();
  if (!image?.selection) {
    return;
  }
  event.preventDefault();
  void copySelection(image, image.selection);
});

function shouldKeepNativeClipboardEvent(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function hasNativeTextSelection() {
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

function isSupportedClipboardFile(file) {
  if (file.type.startsWith("image/")) {
    return true;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "hdr" || extension === "pic" || extension === "exr";
}

function clipboardImageFiles(clipboardData) {
  const files = Array.from(clipboardData?.files || []);
  if (files.length === 0) {
    for (const item of Array.from(clipboardData?.items || [])) {
      if (item.kind !== "file") {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  return files.filter(isSupportedClipboardFile);
}

zoomSelect.addEventListener("change", () => {
  const image = currentImage();
  if (!image || zoomSelect.value === "custom") {
    return;
  }
  if (zoomSelect.value === "fit") {
    fitImageToWindow(image);
  } else {
    const scale = Number(zoomSelect.value);
    const { width, height } = canvasCssSize(image);
    zoomAt(image, width / 2, height / 2, scale);
  }
});

filterSelect.addEventListener("change", () => {
  const image = currentImage();
  if (!image) {
    return;
  }
  image.settings.filter = filterSelect.value;
  requestRender();
  scheduleSessionSave();
});

autoLevelInput.addEventListener("change", () => {
  const image = currentImage();
  if (!image) {
    return;
  }
  image.settings.autoLevel = autoLevelInput.checked;
  image.displayDirty = true;
  requestRender();
  scheduleSessionSave();
});

brightnessInput.addEventListener("change", () => {
  const image = currentImage();
  if (!image) {
    return;
  }
  const value = Number(brightnessInput.value);
  image.settings.brightness = Number.isFinite(value) && value >= 0 ? value : 1;
  brightnessInput.value = String(image.settings.brightness);
  image.displayDirty = true;
  requestRender();
  scheduleSessionSave();
});

brightnessInput.addEventListener("input", () => {
  const image = currentImage();
  if (!image) {
    return;
  }
  const value = Number(brightnessInput.value);
  if (Number.isFinite(value) && value >= 0) {
    image.settings.brightness = value;
    image.displayDirty = true;
    requestRender();
    scheduleSessionSave();
  }
});

brightnessReset.addEventListener("click", () => {
  const image = currentImage();
  if (!image) {
    return;
  }
  image.settings.brightness = 1;
  brightnessInput.value = "1";
  image.displayDirty = true;
  requestRender();
  scheduleSessionSave();
});

brightnessHalf.addEventListener("click", () => scaleBrightness(0.5));
brightnessDouble.addEventListener("click", () => scaleBrightness(2));

function scaleBrightness(factor) {
  const image = currentImage();
  if (!image) {
    return;
  }
  const next = image.settings.brightness * factor;
  if (!Number.isFinite(next) || next < 0) {
    return;
  }
  image.settings.brightness = next;
  brightnessInput.value = String(next);
  image.displayDirty = true;
  requestRender();
  scheduleSessionSave();
}

channelButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-channel]");
  const image = currentImage();
  if (!button || !image) {
    return;
  }
  image.settings.channel = button.dataset.channel;
  image.displayDirty = true;
  updateSettingsPanel();
  updatePickerPanel();
  updateSelectionPanel();
  drawSelectionGraph();
  requestRender();
  scheduleSessionSave();
});

new ResizeObserver(() => {
  for (const image of images) {
    if (image.view.fit) {
      fitImageToWindow(image, false);
    }
  }
  requestRender();
}).observe(viewport);

document.addEventListener("pointermove", (event) => {
  if (!activeDrag) {
    return;
  }
  const dx = event.clientX - activeDrag.startX;
  const dy = event.clientY - activeDrag.startY;
  if (activeDrag.kind === "move") {
    const next = clampImageWindowPosition(activeDrag.image, activeDrag.x + dx, activeDrag.y + dy);
    activeDrag.image.window.x = next.x;
    activeDrag.image.window.y = next.y;
    applyWindowGeometry(activeDrag.image);
  } else if (activeDrag.kind === "resize") {
    activeDrag.image.window.width = Math.max(minWindowWidth, activeDrag.width + dx);
    activeDrag.image.window.height = Math.max(minWindowHeight, activeDrag.height + dy);
    activeDrag.image.view.fit = false;
    applyWindowGeometry(activeDrag.image);
    requestRender();
  } else if (activeDrag.kind === "uiMove") {
    const next = clampPanelPosition(activeDrag.panel, activeDrag.x + dx, activeDrag.y + dy);
    activeDrag.panel.style.left = `${next.x}px`;
    activeDrag.panel.style.top = `${next.y}px`;
  } else if (activeDrag.kind === "selectRect") {
    const pixel = pixelFromEvent(activeDrag.image, event, true);
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      activeDrag.moved = true;
    }
    if (pixel) {
      activeDrag.image.selection = normalizePixelRect(activeDrag.startPixel, pixel);
      updateSelectionPanel();
      requestSelectionGraphDraw();
      requestRender();
    }
  } else if (activeDrag.kind === "graphResize") {
    selectionGraphPanel.style.width = `${Math.max(minGraphWidth, activeDrag.width + dx)}px`;
    selectionGraphPanel.style.height = `${Math.max(minGraphHeight, activeDrag.height + dy)}px`;
    requestSelectionGraphDraw();
  } else if (activeDrag.kind === "graphRotate") {
    graphView.yaw = activeDrag.yaw + dx * 0.01;
    graphView.pitch = clamp(activeDrag.pitch - dy * 0.006, 0.28, 1.22);
    requestSelectionGraphDraw();
  }
});

document.addEventListener("pointerup", (event) => {
  const completedDragKind = activeDrag?.kind;
  if (activeDrag?.kind === "selectRect") {
    const image = activeDrag.image;
    const rect = image.selection;
    try {
      image.elements.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    if (activeDrag.moved && rect && rect.width > 0 && rect.height > 0) {
      fileHint.textContent = `Selected ${rect.width} x ${rect.height}`;
    } else {
      image.selection = null;
      updateSelectionPanel();
      drawSelectionGraph();
      requestRender();
    }
  }
  activeDrag = null;
  if (completedDragKind === "selectRect") {
    updateSelectionPanel();
  }
  if (["selectRect", "graphResize", "graphRotate"].includes(completedDragKind)) {
    drawSelectionGraph();
  }
  if (completedDragKind) {
    scheduleSessionSave();
  }
});

makeFloatingPanelDraggable(inspector);
makeFloatingPanelDraggable(pickerPanel);
makeFloatingPanelDraggable(selectionGraphPanel);
updatePickerPanel();
updateLogDisplayButton();
requestRender();
drawSelectionGraph();
void restoreSavedSession();

async function openFilesWithPicker() {
  try {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{
        description: "Images",
        accept: {
          "image/*": [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".bmp", ".hdr", ".pic", ".exr"]
        }
      }]
    });
    await openFileHandles(handles);
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      fileHint.textContent = "Open failed.";
    }
  } finally {
    fileInput.value = "";
  }
}

async function openDroppedFiles(event, dropPoint = null) {
  const handleItems = Array.from(event.dataTransfer?.items || [])
    .filter((item) => item.kind === "file" && typeof item.getAsFileSystemHandle === "function");
  if (handleItems.length > 0) {
    const handles = [];
    for (const item of handleItems) {
      const handle = await item.getAsFileSystemHandle().catch(() => null);
      if (handle?.kind === "file") {
        handles.push(handle);
      }
    }
    if (handles.length > 0) {
      await openFileHandles(handles, dropPoint);
      return;
    }
  }
  await openFiles(event.dataTransfer.files, dropPoint);
}

async function openFileHandles(handles, dropPoint = null) {
  const entries = [];
  for (const handle of handles) {
    try {
      const file = await handle.getFile();
      entries.push({ file, handle });
    } catch (error) {
      console.warn(error);
    }
  }
  await openFileEntries(entries, dropPoint);
}

async function openFiles(fileList, dropPoint = null, options = {}) {
  const entries = Array.from(fileList || [])
    .filter((file) => file.size > 0)
    .map((file) => ({ file, embedded: Boolean(options.embedded) }));
  await openFileEntries(entries, dropPoint);
}

async function openFileEntries(entries, dropPoint = null) {
  const files = entries.filter((entry) => entry.file?.size > 0);
  if (files.length === 0) {
    return;
  }

  fileHint.textContent = `Loading ${files.length} file${files.length === 1 ? "" : "s"}...`;

  let openedCount = 0;
  const failed = [];
  for (let index = 0; index < files.length; index += 1) {
    const entry = files[index];
    const file = entry.file;
    try {
      const image = await loadImageFile(file);
      image.source = imageSourceForEntry(file, entry);
      images.push(image);
      createImageWindow(image, dropPoint, index);
      selectImage(image);
      fitImageToWindow(image, false);
      updatePickerPanel();
      requestRender();
      openedCount += 1;
    } catch (error) {
      console.error(error);
      failed.push(formatFileError(file, error));
      fileHint.textContent = failed[failed.length - 1];
    }
  }

  dropPrompt.classList.toggle("hidden", images.length > 0);
  if (failed.length > 0) {
    fileHint.textContent = openedCount > 0
      ? `Opened ${openedCount}; ${failed.join("; ")}`
      : failed.join("; ");
  } else {
    fileHint.textContent = `${images.length} image${images.length === 1 ? "" : "s"} opened`;
  }
  updatePickerCursor();
  scheduleSessionSave();
}

function imageSourceForEntry(file, entry) {
  if (entry.embedded) {
    return { kind: "embedded" };
  }
  if (entry.handle) {
    return {
      kind: "file-handle",
      handle: entry.handle,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified
    };
  }
  return {
    kind: "external",
    name: file.name,
    size: file.size,
    lastModified: file.lastModified
  };
}

function formatFileError(file, error) {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const message = rawMessage.replace(/^THREE\.EXRLoader:\s*/, "").trim();
  return message ? `Failed: ${file.name} (${message})` : `Failed: ${file.name}`;
}

async function loadImageFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "exr") {
    return loadDataTexture(file, "exr");
  }
  if (extension === "hdr" || extension === "pic") {
    return loadDataTexture(file, "hdr");
  }
  return loadRasterImage(file);
}

async function loadRasterImage(file) {
  // PNG は自前デコードを優先する。Canvas 2D 経由だと premultiplied alpha の往復で
  // alpha < 255 の画素の RGB が壊れ、さらに getImageData が 8bit 固定なので
  // 16bit PNG の精度も落ちる（値を計測するツールとしては許容できない）。
  const exact = await loadPngExact(file);
  if (exact) {
    return exact;
  }
  return loadCanvasRasterImage(file);
}

async function loadPngExact(file) {
  let bytes;
  try {
    // まず先頭 8 バイトだけ見てシグネチャを判定し、PNG のときだけ全体を読む
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!isPngFile(head)) {
      return null;
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    return null;
  }

  let decoded;
  try {
    decoded = await decodePng(bytes);
  } catch (error) {
    // 未対応の派生仕様などは Canvas 経路に落として読み込み自体は成功させる
    console.warn(`Exact PNG decode failed, falling back to canvas: ${error.message}`);
    return null;
  }

  // 画素ごとに Math.pow を 3 回呼ぶと大きい画像で重いので、取りうるサンプル値
  // （最大 65536 通り）ぶんの LUT を先に作ってから引く。
  const sampleMax = decoded.sampleMax;
  const toLinear = new Float32Array(sampleMax + 1);
  for (let sample = 0; sample <= sampleMax; sample += 1) {
    toLinear[sample] = srgbToLinear(sample / sampleMax);
  }

  const pixels = new Float32Array(decoded.width * decoded.height * 4);
  const data = decoded.data;
  for (let i = 0; i < data.length; i += 4) {
    pixels[i] = toLinear[Math.round(data[i] * sampleMax)];
    pixels[i + 1] = toLinear[Math.round(data[i + 1] * sampleMax)];
    pixels[i + 2] = toLinear[Math.round(data[i + 2] * sampleMax)];
    pixels[i + 3] = data[i + 3];
  }

  const record = createImageRecord(file, decoded.width, decoded.height, pngTypeLabel(decoded), pixels, "raster");
  const note = pngTransferNote(decoded);
  if (note) {
    record.type = `${record.type} ${note}`;
  }
  return record;
}

// sRGB 前提で線形化しているので、それと食い違う指定が入っている場合は Type 欄に出す。
function pngTransferNote(decoded) {
  if (decoded.hasIccProfile) {
    return "(iCCP ignored)";
  }
  // sRGB の gAMA は 1/2.2 ≒ 0.4545。そこから外れる指定は sRGB 前提と矛盾する
  if (decoded.gamma !== null && Math.abs(decoded.gamma - 0.45455) > 0.02) {
    return `(gAMA ${decoded.gamma.toFixed(4)} ignored)`;
  }
  return "";
}

async function loadCanvasRasterImage(file) {
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none" }).catch(() => createImageBitmap(file));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = bitmap.width;
  sourceCanvas.height = bitmap.height;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const toLinear = new Float32Array(256);
  for (let sample = 0; sample < 256; sample += 1) {
    toLinear[sample] = srgbToLinear(sample / 255);
  }

  const pixels = new Float32Array(sourceCanvas.width * sourceCanvas.height * 4);
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 4) {
    pixels[j] = toLinear[imageData.data[i]];
    pixels[j + 1] = toLinear[imageData.data[i + 1]];
    pixels[j + 2] = toLinear[imageData.data[i + 2]];
    pixels[j + 3] = imageData.data[i + 3] / 255;
  }

  const record = createImageRecord(file, sourceCanvas.width, sourceCanvas.height, "raster/srgb", pixels, "raster");
  if (record.range.min[3] < 1) {
    // Canvas 経路は premultiplied alpha の往復を通るため、半透明画素の RGB は
    // ファイルの値と一致しない（alpha が小さいほど誤差が大きい）。計測前に気付けるよう明示する。
    record.type = `${record.type} (canvas: RGB approximate where alpha < 1)`;
  }
  return record;
}

async function loadDataTexture(file, kind) {
  const buffer = await file.arrayBuffer();
  const loader = kind === "exr" ? new EXRLoader() : new HDRLoader();
  if (typeof loader.setDataType === "function") {
    loader.setDataType(THREE.FloatType);
  }
  const parsed = loader.parse(buffer);
  const { data, width, height } = extractTextureData(parsed);
  const itemSize = Math.max(1, Math.round(data.length / (width * height)));
  const canReusePixels = data instanceof Float32Array && itemSize === 4;
  const pixels = canReusePixels ? data : new Float32Array(width * height * 4);

  if (canReusePixels) {
    if (kind === "exr") {
      flipPixelRows(pixels, width, height);
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourcePixel = kind === "exr" ? (height - 1 - y) * width + x : y * width + x;
        const sourceIndex = sourcePixel * itemSize;
        const targetIndex = (y * width + x) * 4;
        pixels[targetIndex] = readTextureValue(data, sourceIndex);
        pixels[targetIndex + 1] = readTextureValue(data, sourceIndex + Math.min(1, itemSize - 1));
        pixels[targetIndex + 2] = readTextureValue(data, sourceIndex + Math.min(2, itemSize - 1));
        pixels[targetIndex + 3] = itemSize >= 4 ? readTextureValue(data, sourceIndex + 3) : 1;
      }
    }
  }

  parsed.dispose?.();
  return createImageRecord(file, width, height, kind === "exr" ? "openexr/linear" : "radiance-hdr/linear", pixels, kind);
}

function flipPixelRows(pixels, width, height) {
  const rowLength = width * 4;
  const topRow = new Float32Array(rowLength);
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const topOffset = top * rowLength;
    const bottomOffset = bottom * rowLength;
    topRow.set(pixels.subarray(topOffset, topOffset + rowLength));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowLength);
    pixels.set(topRow, bottomOffset);
  }
}

function extractTextureData(parsed) {
  const candidates = [
    parsed,
    parsed?.image,
    parsed?.source?.data
  ];

  for (const candidate of candidates) {
    if (candidate?.data && candidate?.width && candidate?.height) {
      return {
        data: candidate.data,
        width: candidate.width,
        height: candidate.height
      };
    }
  }

  throw new Error("Decoded HDR/EXR data did not contain pixel data, width, and height.");
}

function createImageRecord(file, width, height, type, pixels, sourceFormat = "raster") {
  const id = nextId;
  nextId += 1;
  const range = computeRange(pixels);
  return {
    id,
    name: file.name,
    width,
    height,
    type,
    sourceFormat,
    source: { kind: "external", name: file.name },
    pixels,
    range,
    settings: {
      autoLevel: sourceFormat === "hdr" || sourceFormat === "exr",
      brightness: 1,
      // UE 書き出しの EXR などアルファが全面 0 の画像は RGBA 表示だと真っ黒になるため RGB を既定にする
      channel: range.max[3] > 0 ? "rgba" : "rgb",
      filter: "auto"
    },
    view: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      fit: true
    },
    pickers: [],
    selection: null,
    window: {
      x: 24,
      y: 24,
      width: 420,
      height: 300,
      z: 1
    },
    elements: null,
    displayCanvas: null,
    displayDirty: true
  };
}

function createImageWindow(image, dropPoint, placementIndex) {
  const viewportRect = viewport.getBoundingClientRect();
  const preferredWidth = Math.min(Math.max(320, image.width + 2), Math.max(320, viewportRect.width * 0.46));
  const bodyHeight = preferredWidth * (image.height / image.width);
  const preferredHeight = Math.min(Math.max(220, bodyHeight + 30), Math.max(220, viewportRect.height * 0.46));
  const baseX = dropPoint ? dropPoint.x - preferredWidth / 2 : 32 + placementIndex * 36 + images.length * 18;
  const baseY = dropPoint ? dropPoint.y - 18 : 32 + placementIndex * 30 + images.length * 18;

  image.window.width = preferredWidth;
  image.window.height = preferredHeight;
  image.window.x = clamp(baseX, 8, Math.max(8, viewportRect.width - preferredWidth - 8));
  image.window.y = clamp(baseY, 8, Math.max(8, viewportRect.height - preferredHeight - 8));
  image.window.z = ++topZ;

  const frame = document.createElement("section");
  frame.className = "image-window";
  frame.dataset.id = String(image.id);

  const titlebar = document.createElement("div");
  titlebar.className = "window-titlebar";
  const title = document.createElement("div");
  title.className = "window-title";
  title.textContent = image.name;
  const size = document.createElement("div");
  size.className = "window-size";
  size.textContent = `${image.width}x${image.height}`;
  const closeButton = document.createElement("button");
  closeButton.className = "window-close";
  closeButton.type = "button";
  closeButton.ariaLabel = "Close image window";
  closeButton.textContent = "x";
  titlebar.append(title, size, closeButton);

  const body = document.createElement("div");
  body.className = "window-body";

  const canvas = document.createElement("canvas");
  canvas.className = "image-canvas";

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "resize-handle";

  body.append(canvas, resizeHandle);
  frame.append(titlebar, body);
  windowLayer.append(frame);

  image.elements = {
    frame,
    titlebar,
    body,
    canvas,
    ctx: canvas.getContext("2d", { alpha: false }),
    resizeHandle,
    closeButton
  };

  frame.addEventListener("pointerdown", () => selectImage(image));

  titlebar.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".window-close")) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    selectImage(image);
    activeDrag = {
      kind: "move",
      image,
      startX: event.clientX,
      startY: event.clientY,
      x: image.window.x,
      y: image.window.y
    };
    titlebar.setPointerCapture(event.pointerId);
  });

  closeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (confirm(`Close "${image.name}"?`)) {
      closeImage(image);
    }
  });

  resizeHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectImage(image);
    activeDrag = {
      kind: "resize",
      image,
      startX: event.clientX,
      startY: event.clientY,
      width: image.window.width,
      height: image.window.height
    };
    resizeHandle.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  canvas.addEventListener("pointerdown", (event) => {
    selectImage(image);
    if (pickerMode && activePanelTab === "pickers" && event.button === 0) {
      event.preventDefault();
      togglePickerAtEvent(image, event);
      return;
    }
    if (!pickerMode && event.button === 0) {
      const pixel = pixelFromEvent(image, event, true);
      event.preventDefault();
      image.selection = normalizePixelRect(pixel, pixel);
      updateSelectionPanel();
      drawSelectionGraph();
      activeDrag = {
        kind: "selectRect",
        image,
        startX: event.clientX,
        startY: event.clientY,
        startPixel: pixel,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      requestRender();
      return;
    }
    if (event.button !== 2 && event.button !== 1) {
      return;
    }
    event.preventDefault();
    image.pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: image.view.offsetX,
      offsetY: image.view.offsetY
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("panning");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (image.pan) {
      image.view.offsetX = image.pan.offsetX + event.clientX - image.pan.x;
      image.view.offsetY = image.pan.offsetY + event.clientY - image.pan.y;
      requestRender();
    }
    updatePixelReadout(image, event);
  });

  canvas.addEventListener("pointerup", (event) => endImagePan(image, event));
  canvas.addEventListener("pointercancel", (event) => endImagePan(image, event));
  canvas.addEventListener("pointerleave", () => {
    if (!image.pan) {
      clearPixelReadout();
    }
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    selectImage(image);
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const factor = Math.pow(2, -event.deltaY / 420);
    zoomAt(image, x, y, image.view.scale * factor);
  });

  applyWindowGeometry(image);
}

function selectImage(image) {
  selectedId = image.id;
  image.window.z = ++topZ;
  for (const item of images) {
    item.elements?.frame.classList.toggle("active", item.id === image.id);
    if (item.id === image.id) {
      item.elements.frame.style.zIndex = String(image.window.z);
    }
  }
  updateSettingsPanel();
  updateSelectionPanel();
  drawSelectionGraph();
  updateViewState();
  scheduleSessionSave();
}

function clearActiveSelection() {
  selectedId = null;
  for (const image of images) {
    image.elements?.frame.classList.remove("active");
  }
  updateSettingsPanel();
  updateSelectionPanel();
  drawSelectionGraph();
  updateViewState();
  scheduleSessionSave();
}

function applyWindowGeometry(image) {
  const { frame } = image.elements;
  const next = clampImageWindowPosition(image, image.window.x, image.window.y);
  image.window.x = next.x;
  image.window.y = next.y;
  frame.style.left = `${image.window.x}px`;
  frame.style.top = `${image.window.y}px`;
  frame.style.width = `${image.window.width}px`;
  frame.style.height = `${image.window.height}px`;
  frame.style.zIndex = String(image.window.z);
}

function clampImageWindowPosition(image, x, y) {
  const viewportRect = viewport.getBoundingClientRect();
  return {
    x: clamp(x, 8, Math.max(8, viewportRect.width - image.window.width - 8)),
    y: clamp(y, 8, Math.max(8, viewportRect.height - image.window.height - 8))
  };
}

function makeFloatingPanelDraggable(panel) {
  const title = panel.querySelector(".panel-title, .graph-titlebar");
  title.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, select, input, textarea")) {
      return;
    }
    panel.classList.toggle("collapsed");
    drawSelectionGraph();
    scheduleSessionSave();
  });

  title.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, select, input, textarea")) {
      return;
    }
    event.preventDefault();
    const panelRect = panel.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    panel.style.left = `${panelRect.left - viewportRect.left}px`;
    panel.style.top = `${panelRect.top - viewportRect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.zIndex = String(++topUiZ);
    activeDrag = {
      kind: "uiMove",
      panel,
      startX: event.clientX,
      startY: event.clientY,
      x: panelRect.left - viewportRect.left,
      y: panelRect.top - viewportRect.top
    };
    title.setPointerCapture(event.pointerId);
  });
}

function clampPanelPosition(panel, x, y) {
  const viewportRect = viewport.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return {
    x: clamp(x, 8, Math.max(8, viewportRect.width - panelRect.width - 8)),
    y: clamp(y, 8, Math.max(8, viewportRect.height - panelRect.height - 8))
  };
}

function closeImage(image) {
  const index = images.findIndex((item) => item.id === image.id);
  if (index === -1) {
    return;
  }
  image.elements?.frame.remove();
  images.splice(index, 1);
  if (selectedId === image.id) {
    selectedId = images.length ? images[images.length - 1].id : null;
    const nextImage = currentImage();
    if (nextImage) {
      selectImage(nextImage);
    } else {
      updateSettingsPanel();
      updateViewState();
    }
  }
  dropPrompt.classList.toggle("hidden", images.length > 0);
  fileHint.textContent = images.length ? `${images.length} image${images.length === 1 ? "" : "s"} opened` : "Drop images on the black view";
  updatePickerCursor();
  updatePickerPanel();
  updateSelectionPanel();
  drawSelectionGraph();
  requestRender();
  scheduleSessionSave();
}

function togglePickerAtEvent(image, event) {
  if (activePanelTab !== "pickers") {
    return;
  }
  const pixel = pixelFromEvent(image, event);
  if (!pixel) {
    return;
  }

  const existingIndex = image.pickers.findIndex((picker) => picker.x === pixel.x && picker.y === pixel.y);
  if (existingIndex !== -1) {
    image.pickers.splice(existingIndex, 1);
    updatePickerPanel();
    requestRender();
    scheduleSessionSave();
    return;
  }

  if (allPickers().length >= maxPickers) {
    fileHint.textContent = `Picker limit is ${maxPickers}.`;
    return;
  }

  image.pickers.push({
    id: nextAvailablePickerId(),
    x: pixel.x,
    y: pixel.y,
    color: nextPickerColor()
  });
  updatePickerPanel();
  requestRender();
  scheduleSessionSave();
}

function nextAvailablePickerId() {
  const usedIds = new Set(allPickers().map(({ picker }) => picker.id));
  let id = 1;
  while (usedIds.has(id)) {
    id += 1;
  }
  return id;
}

function removePicker(pickerId) {
  if (activePanelTab !== "pickers") {
    return;
  }
  for (const image of images) {
    const index = image.pickers.findIndex((picker) => picker.id === pickerId);
    if (index !== -1) {
      image.pickers.splice(index, 1);
      updatePickerPanel();
      requestRender();
      scheduleSessionSave();
      return;
    }
  }
}

function drawPickers(image, ctx) {
  const { width, height } = canvasCssSize(image);
  for (const picker of image.pickers) {
    const x = image.view.offsetX + (picker.x + 0.5) * image.view.scale;
    const y = image.view.offsetY + (picker.y + 0.5) * image.view.scale;
    if (x < -24 || y < -24 || x > width + 24 || y > height + 24) {
      continue;
    }

    const arm = 9;
    ctx.save();
    ctx.lineCap = "square";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    drawCross(ctx, x, y, arm);
    ctx.strokeStyle = picker.color;
    ctx.lineWidth = 2;
    drawCross(ctx, x, y, arm);
    ctx.fillStyle = picker.color;
    ctx.font = "11px Consolas, monospace";
    ctx.fillText(String(picker.id), x + 7, y - 7);
    ctx.restore();
  }
}

function drawCross(ctx, x, y, arm) {
  ctx.beginPath();
  ctx.moveTo(x - arm, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm);
  ctx.lineTo(x, y + arm);
  ctx.stroke();
}

function drawSelection(image, ctx) {
  if (!image.selection) {
    return;
  }
  const rect = image.selection;
  const x = image.view.offsetX + rect.x * image.view.scale;
  const y = image.view.offsetY + rect.y * image.view.scale;
  const width = rect.width * image.view.scale;
  const height = rect.height * image.view.scale;
  const canvasSize = canvasCssSize(image);
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(x + 0.5, y + 0.5, width, height);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = 6;
  ctx.strokeRect(x + 0.5, y + 0.5, width, height);
  ctx.setLineDash([]);

  const label = `${rect.width} x ${rect.height} px`;
  ctx.font = "12px Consolas, monospace";
  const metrics = ctx.measureText(label);
  const labelWidth = Math.ceil(metrics.width) + 8;
  const labelHeight = 18;
  const labelX = Math.max(2, Math.min(x, canvasSize.width - labelWidth - 2));
  const labelY = y >= labelHeight + 4 ? y - labelHeight - 4 : y + 4;

  ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
  ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.strokeRect(labelX + 0.5, labelY + 0.5, labelWidth, labelHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, labelX + 4, labelY + 13);
  ctx.restore();
}

function normalizePixelRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1
  };
}

async function copySelection(image, rect) {
  internalClipboard = {
    name: `${image.name} crop`,
    type: `${image.type}/crop`,
    sourceFormat: image.sourceFormat,
    width: rect.width,
    height: rect.height,
    pixels: cropPixels(image, rect),
    internalOnly: isHdrImage(image)
  };

  if (internalClipboard.internalOnly) {
    fileHint.textContent = `Copied HDR values internally ${rect.width} x ${rect.height}`;
    return;
  }

  const canvas = makeRawCanvas(image, rect);
  try {
    await writeCanvasToClipboard(canvas);
    fileHint.textContent = `Copied ${rect.width} x ${rect.height}`;
  } catch {
    fileHint.textContent = `Copied internally ${rect.width} x ${rect.height}`;
  }
}

function isHdrImage(image) {
  return image.type.startsWith("openexr/") || image.type.startsWith("radiance-hdr/");
}

function cropPixels(image, rect) {
  const pixels = new Float32Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * image.width + rect.x) * 4;
    const targetStart = y * rect.width * 4;
    pixels.set(image.pixels.subarray(sourceStart, sourceStart + rect.width * 4), targetStart);
  }
  return pixels;
}

function makeRawCanvas(image, rect = null) {
  const sourceRect = rect || { x: 0, y: 0, width: image.width, height: image.height };
  const canvas = document.createElement("canvas");
  canvas.width = sourceRect.width;
  canvas.height = sourceRect.height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(sourceRect.width, sourceRect.height);

  for (let y = 0; y < sourceRect.height; y += 1) {
    for (let x = 0; x < sourceRect.width; x += 1) {
      const sourceIndex = ((sourceRect.y + y) * image.width + sourceRect.x + x) * 4;
      const targetIndex = (y * sourceRect.width + x) * 4;
      imageData.data[targetIndex] = linearToSrgbByte(image.pixels[sourceIndex]);
      imageData.data[targetIndex + 1] = linearToSrgbByte(image.pixels[sourceIndex + 1]);
      imageData.data[targetIndex + 2] = linearToSrgbByte(image.pixels[sourceIndex + 2]);
      imageData.data[targetIndex + 3] = Math.round(clamp01(image.pixels[sourceIndex + 3]) * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function writeCanvasToClipboard(canvas) {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image write is not available.");
  }
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Failed to encode clipboard image.")), "image/png");
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function pasteInternalClipboard() {
  const copied = internalClipboard;
  if (!copied) {
    return;
  }
  const image = createImageRecord(
    { name: copied.name },
    copied.width,
    copied.height,
    copied.type,
    new Float32Array(copied.pixels),
    copied.sourceFormat
  );
  image.source = { kind: "embedded" };
  images.push(image);
  createImageWindow(image, null, 0);
  selectImage(image);
  fitImageToWindow(image, false);
  dropPrompt.classList.add("hidden");
  fileHint.textContent = `${images.length} image${images.length === 1 ? "" : "s"} opened`;
  requestRender();
  scheduleSessionSave();
}

function saveImage(image, format) {
  if (!allowedSaveFormats(image).includes(format)) {
    fileHint.textContent = "Save format is locked to the source format.";
    return;
  }
  if (format === "hdr") {
    if (!confirmHdrSave(image)) {
      return;
    }
    downloadBytes(encodeHdr(image), `${stripExtension(image.name)}.hdr`, "image/vnd.radiance");
    return;
  }
  if (format === "exr") {
    downloadBytes(encodeExr(image), `${stripExtension(image.name)}.exr`, "image/aces");
    return;
  }

  const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  const extension = format === "jpeg" ? "jpg" : format;
  const canvas = makeRawCanvas(image);
  canvas.toBlob((blob) => {
    if (!blob) {
      fileHint.textContent = "Save failed.";
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${stripExtension(image.name)}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, mime, 0.95);
}

function encodeHdr(image) {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${image.height} +X ${image.width}\n`;
  const headerBytes = new TextEncoder().encode(header);
  const pixels = new Uint8Array(image.width * image.height * 4);

  for (let i = 0, j = 0; i < image.pixels.length; i += 4, j += 4) {
    const rgbe = linearRgbToRgbe(image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]);
    pixels[j] = rgbe[0];
    pixels[j + 1] = rgbe[1];
    pixels[j + 2] = rgbe[2];
    pixels[j + 3] = rgbe[3];
  }

  const out = new Uint8Array(headerBytes.length + pixels.length);
  out.set(headerBytes, 0);
  out.set(pixels, headerBytes.length);
  return out;
}

function confirmHdrSave(image) {
  const hasNegative = image.range.min[0] < 0 || image.range.min[1] < 0 || image.range.min[2] < 0;
  const message = hasNegative
    ? "HDR RGBE cannot store negative values and is not exact. Negative RGB values will be clamped to 0. Use EXR Float for value-preserving export.\n\nSave as HDR anyway?"
    : "HDR RGBE is not exact because RGB channels share one exponent. Use EXR Float for value-preserving export.\n\nSave as HDR anyway?";
  return confirm(message);
}

function linearRgbToRgbe(r, g, b) {
  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);
  const value = Math.max(r, g, b);
  if (!Number.isFinite(value) || value < 1e-32) {
    return [0, 0, 0, 0];
  }
  const exponent = Math.floor(Math.log2(value)) + 1;
  const scale = Math.pow(2, exponent - 8);
  return [
    clampByte(r / scale),
    clampByte(g / scale),
    clampByte(b / scale),
    exponent + 128
  ];
}

function encodeExr(image) {
  const header = new ByteWriter();
  header.u32(20000630);
  header.u32(2);
  writeExrAttribute(header, "channels", "chlist", (writer) => {
    for (const channel of ["A", "B", "G", "R"]) {
      writer.cstring(channel);
      writer.i32(2);
      writer.u8(0);
      writer.u8(0);
      writer.u8(0);
      writer.u8(0);
      writer.i32(1);
      writer.i32(1);
    }
    writer.u8(0);
  });
  writeExrAttribute(header, "compression", "compression", (writer) => writer.u8(0));
  writeExrAttribute(header, "dataWindow", "box2i", (writer) => {
    writer.i32(0);
    writer.i32(0);
    writer.i32(image.width - 1);
    writer.i32(image.height - 1);
  });
  writeExrAttribute(header, "displayWindow", "box2i", (writer) => {
    writer.i32(0);
    writer.i32(0);
    writer.i32(image.width - 1);
    writer.i32(image.height - 1);
  });
  writeExrAttribute(header, "lineOrder", "lineOrder", (writer) => writer.u8(0));
  writeExrAttribute(header, "pixelAspectRatio", "float", (writer) => writer.f32(1));
  writeExrAttribute(header, "screenWindowCenter", "v2f", (writer) => {
    writer.f32(0);
    writer.f32(0);
  });
  writeExrAttribute(header, "screenWindowWidth", "float", (writer) => writer.f32(1));
  header.u8(0);

  const headerBytes = header.bytes();
  const scanlineCount = image.height;
  const chunkDataSize = image.width * 4 * 4;
  const chunkSize = 8 + chunkDataSize;
  const totalSize = headerBytes.length + scanlineCount * 8 + scanlineCount * chunkSize;
  const out = new ByteWriter(totalSize);
  out.bytes(headerBytes);

  let offset = headerBytes.length + scanlineCount * 8;
  for (let y = 0; y < image.height; y += 1) {
    out.u64(offset);
    offset += chunkSize;
  }

  for (let y = 0; y < image.height; y += 1) {
    out.i32(y);
    out.u32(chunkDataSize);
    for (const channelIndex of [3, 2, 1, 0]) {
      for (let x = 0; x < image.width; x += 1) {
        const sourceIndex = (y * image.width + x) * 4 + channelIndex;
        out.f32(image.pixels[sourceIndex]);
      }
    }
  }

  return out.bytes();
}

function writeExrAttribute(writer, name, type, writeValue) {
  const value = new ByteWriter();
  writeValue(value);
  const bytes = value.bytes();
  writer.cstring(name);
  writer.cstring(type);
  writer.u32(bytes.length);
  writer.bytes(bytes);
}

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clampByte(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

class ByteWriter {
  constructor(size = 1024) {
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  ensure(size) {
    if (this.offset + size <= this.buffer.byteLength) {
      return;
    }
    let nextSize = this.buffer.byteLength;
    while (this.offset + size > nextSize) {
      nextSize *= 2;
    }
    const next = new Uint8Array(nextSize);
    next.set(new Uint8Array(this.buffer));
    this.buffer = next.buffer;
    this.view = new DataView(this.buffer);
  }

  u8(value) {
    this.ensure(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  i32(value) {
    this.ensure(4);
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  u32(value) {
    this.ensure(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  u64(value) {
    this.ensure(8);
    const low = value >>> 0;
    const high = Math.floor(value / 0x100000000) >>> 0;
    this.view.setUint32(this.offset, low, true);
    this.view.setUint32(this.offset + 4, high, true);
    this.offset += 8;
  }

  f32(value) {
    this.ensure(4);
    this.view.setFloat32(this.offset, Number.isFinite(value) ? value : 0, true);
    this.offset += 4;
  }

  cstring(value) {
    const encoded = new TextEncoder().encode(value);
    this.bytes(encoded);
    this.u8(0);
  }

  bytes(value = null) {
    if (value) {
      this.ensure(value.length);
      new Uint8Array(this.buffer, this.offset, value.length).set(value);
      this.offset += value.length;
      return null;
    }
    return new Uint8Array(this.buffer.slice(0, this.offset));
  }
}

function scheduleSessionSave() {
  if (restoringSession || !window.indexedDB) {
    return;
  }
  clearTimeout(saveSessionTimer);
  saveSessionTimer = setTimeout(() => {
    saveSessionTimer = null;
    void saveCurrentSession();
  }, 450);
}

async function saveCurrentSession() {
  try {
    const db = await openSessionDb();
    await idbPut(db, sessionStoreName, buildSessionRecord(), sessionKey);
    db.close();
  } catch (error) {
    console.warn("Session save skipped.", error);
  }
}

async function restoreSavedSession() {
  if (!window.indexedDB) {
    return;
  }

  restoringSession = true;
  try {
    const db = await openSessionDb();
    const session = await idbGet(db, sessionStoreName, sessionKey);
    db.close();
    if (!session || session.version !== 1) {
      return;
    }

    applyAppSessionState(session);

    let restoredCount = 0;
    let skippedCount = 0;
    for (const savedImage of session.images || []) {
      try {
        const image = await restoreImageFromSession(savedImage);
        if (!image) {
          skippedCount += 1;
          continue;
        }
        images.push(image);
        createImageWindow(image, null, restoredCount);
        applySavedImageState(image, savedImage);
        applyWindowGeometry(image);
        restoredCount += 1;
      } catch (error) {
        skippedCount += 1;
        console.warn("Saved image restore skipped.", error);
      }
    }

    nextId = Math.max(nextId, ...images.map((image) => image.id + 1), session.nextId || 1);
    topZ = Math.max(topZ, ...images.map((image) => image.window.z), session.topZ || topZ);
    topUiZ = Math.max(topUiZ, session.topUiZ || topUiZ);
    selectedId = images.some((image) => image.id === session.selectedId) ? session.selectedId : images.at(-1)?.id ?? null;

    dropPrompt.classList.toggle("hidden", images.length > 0);
    if (selectedId !== null) {
      const image = currentImage();
      if (image) {
        selectImage(image);
      }
    } else {
      updateSettingsPanel();
      updateSelectionPanel();
      drawSelectionGraph();
      updateViewState();
    }
    updatePickerPanel();
    updatePickerCursor();
    requestRender();

    if (restoredCount > 0 || skippedCount > 0) {
      fileHint.textContent = skippedCount > 0
        ? `Restored ${restoredCount}; skipped ${skippedCount} unavailable`
        : `Restored ${restoredCount} image${restoredCount === 1 ? "" : "s"}`;
    }
  } catch (error) {
    console.warn("Session restore skipped.", error);
  } finally {
    restoringSession = false;
  }
}

function buildSessionRecord() {
  return {
    version: 1,
    savedAt: Date.now(),
    selectedId,
    nextId,
    topZ,
    topUiZ,
    activePanelTab,
    pickerMode,
    pickerValueMode: pickerValueMode.value,
    pickerCopyMode: pickerCopyMode.value,
    graphView: { ...graphView },
    logDisplayMode,
    panels: {
      inspector: panelSessionState(inspector),
      picker: panelSessionState(pickerPanel),
      graph: panelSessionState(selectionGraphPanel)
    },
    images: images.map(imageSessionState)
  };
}

function imageSessionState(image) {
  return {
    id: image.id,
    name: image.name,
    width: image.width,
    height: image.height,
    type: image.type,
    sourceFormat: image.sourceFormat,
    source: imageSourceSessionState(image),
    settings: { ...image.settings },
    view: { ...image.view },
    pickers: image.pickers.map((picker) => ({ ...picker })),
    selection: image.selection ? { ...image.selection } : null,
    window: { ...image.window }
  };
}

function imageSourceSessionState(image) {
  const source = image.source || { kind: "external" };
  if (source.kind === "embedded") {
    return {
      kind: "embedded",
      pixels: image.pixels.buffer.slice(image.pixels.byteOffset, image.pixels.byteOffset + image.pixels.byteLength)
    };
  }
  if (source.kind === "file-handle" && source.handle) {
    return {
      kind: "file-handle",
      handle: source.handle,
      name: source.name || image.name,
      size: source.size || 0,
      lastModified: source.lastModified || 0
    };
  }
  return {
    kind: "external",
    name: source.name || image.name,
    size: source.size || 0,
    lastModified: source.lastModified || 0
  };
}

function panelSessionState(panel) {
  return {
    collapsed: panel.classList.contains("collapsed"),
    left: panel.style.left,
    top: panel.style.top,
    right: panel.style.right,
    bottom: panel.style.bottom,
    width: panel.style.width,
    height: panel.style.height,
    zIndex: panel.style.zIndex
  };
}

function applyAppSessionState(session) {
  if (typeof session.pickerValueMode === "string") {
    pickerValueMode.value = session.pickerValueMode;
  }
  if (typeof session.pickerCopyMode === "string") {
    pickerCopyMode.value = session.pickerCopyMode;
  }
  if (session.graphView) {
    graphView.yaw = finiteOrDefault(session.graphView.yaw, graphView.yaw);
    graphView.pitch = finiteOrDefault(session.graphView.pitch, graphView.pitch);
  }
  if (typeof session.logDisplayMode === "boolean") {
    logDisplayMode = session.logDisplayMode;
    updateLogDisplayButton();
  }
  applyPanelSessionState(inspector, session.panels?.inspector);
  applyPanelSessionState(pickerPanel, session.panels?.picker);
  applyPanelSessionState(selectionGraphPanel, session.panels?.graph);
  setPanelTab(session.activePanelTab === "selection" ? "selection" : "pickers");
  setPickerMode(Boolean(session.pickerMode));
}

function applyPanelSessionState(panel, state) {
  if (!state) {
    return;
  }
  panel.classList.toggle("collapsed", Boolean(state.collapsed));
  for (const key of ["left", "top", "right", "bottom", "width", "height", "zIndex"]) {
    if (typeof state[key] === "string") {
      panel.style[key] = state[key];
    }
  }
}

async function restoreImageFromSession(savedImage) {
  const source = savedImage.source || {};
  if (source.kind === "embedded" && source.pixels instanceof ArrayBuffer) {
    const pixels = new Float32Array(source.pixels);
    if (pixels.length !== savedImage.width * savedImage.height * 4) {
      return null;
    }
    const image = createImageRecord(
      { name: savedImage.name || "pasted image" },
      savedImage.width,
      savedImage.height,
      savedImage.type || "raster/srgb",
      pixels,
      savedImage.sourceFormat || "raster"
    );
    image.source = { kind: "embedded" };
    return image;
  }

  if (source.kind === "file-handle" && source.handle && typeof source.handle.getFile === "function") {
    const file = await source.handle.getFile();
    const image = await loadImageFile(file);
    image.source = {
      kind: "file-handle",
      handle: source.handle,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified
    };
    return image;
  }

  return null;
}

function applySavedImageState(image, savedImage) {
  image.id = Number.isInteger(savedImage.id) ? savedImage.id : image.id;
  image.name = savedImage.name || image.name;
  image.settings = {
    ...image.settings,
    ...(savedImage.settings || {})
  };
  image.view = {
    ...image.view,
    ...(savedImage.view || {})
  };
  image.pickers = Array.isArray(savedImage.pickers)
    ? savedImage.pickers.filter((picker) => Number.isInteger(picker.x) && Number.isInteger(picker.y)).map((picker) => ({ ...picker }))
    : [];
  image.selection = savedImage.selection ? clampSavedRect(savedImage.selection, image.width, image.height) : null;
  image.window = {
    ...image.window,
    ...(savedImage.window || {})
  };
  if (image.elements) {
    image.elements.frame.dataset.id = String(image.id);
    image.elements.frame.querySelector(".window-title").textContent = image.name;
    image.elements.frame.querySelector(".window-size").textContent = `${image.width}x${image.height}`;
  }
  image.displayDirty = true;
}

function clampSavedRect(rect, width, height) {
  const x = clamp(Math.floor(rect.x || 0), 0, Math.max(0, width - 1));
  const y = clamp(Math.floor(rect.y || 0), 0, Math.max(0, height - 1));
  const rectWidth = clamp(Math.floor(rect.width || 1), 1, width - x);
  const rectHeight = clamp(Math.floor(rect.height || 1), 1, height - y);
  return { x, y, width: rectWidth, height: rectHeight };
}

function finiteOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function openSessionDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(sessionDbName, sessionDbVersion);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(sessionStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db, storeName, value, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function stripExtension(name) {
  return name.replace(/\.[^.]+$/, "");
}

function setPanelTab(tab) {
  activePanelTab = tab;
  const showPickers = tab === "pickers";
  if (!showPickers) {
    setPickerMode(false);
  }
  pickersTabButton.classList.toggle("active", showPickers);
  selectionTabButton.classList.toggle("active", !showPickers);
  pickersTabContent.classList.toggle("hidden", !showPickers);
  selectionTabContent.classList.toggle("hidden", showPickers);
  if (showPickers) {
    updatePickerPanel();
  } else {
    updateSelectionPanel();
  }
  scheduleSessionSave();
}

function setPickerMode(enabled) {
  pickerMode = enabled && activePanelTab === "pickers";
  pickerModeButton.classList.toggle("active", pickerMode);
  updatePickerCursor();
  scheduleSessionSave();
}

function updatePickerPanel() {
  const rows = allPickers();
  pickerRows.replaceChildren();

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "No pickers.";
    pickerRows.append(empty);
  } else {
    for (const { image, picker } of rows) {
      const values = pickerValues(image, picker);
      const row = document.createElement("div");
      row.className = "picker-row";

      const markerChip = document.createElement("span");
      markerChip.className = "picker-marker-chip";
      markerChip.style.backgroundColor = picker.color;

      const sampleChip = document.createElement("span");
      sampleChip.className = "sample-chip";
      sampleChip.style.backgroundColor = sampleCssColor(image, values.linear);

      const label = document.createElement("span");
      label.textContent = `P${picker.id} ${picker.x},${picker.y}`;
      label.title = image.name;

      const value = document.createElement("span");
      value.textContent = formatPickerValue(image, values);

      const remove = document.createElement("button");
      remove.className = "picker-remove";
      remove.type = "button";
      remove.textContent = "x";
      remove.title = "Remove picker";
      remove.addEventListener("click", () => removePicker(picker.id));

      row.append(markerChip, sampleChip, label, value, remove);
      pickerRows.append(row);
    }
  }

  pickerCopyText.value = pickerCopyTextValue(rows);
}

function pickerCopyTextValue(rows) {
  const mode = pickerValueMode.value;
  const valueOnly = pickerCopyMode.value === "values";
  const rowData = rows.map(({ image, picker }) => {
    const channels = valueChannels(image);
    const values = pickerValues(image, picker);
    return {
      image,
      picker,
      channels,
      tuple: valueTupleForMode(values, mode, channels)
    };
  });
  const lines = [];
  if (!valueOnly) {
    const csvChannels = unionChannels(rowData.map((row) => row.channels));
    lines.push(["id", "image", "x", "y", "mode", "display", ...csvChannels.map((channel) => channel.key)].join(","));
    for (const row of rowData) {
      const valueByChannel = new Map(row.channels.map((channel, index) => [channel.key, row.tuple[index]]));
      lines.push([
        csvCell(`P${row.picker.id}`),
        csvCell(row.image.name),
        row.picker.x,
        row.picker.y,
        mode,
        displayChannelLabel(row.image),
        ...csvChannels.map((channel) => valueByChannel.get(channel.key) ?? "")
      ].join(","));
    }
    return lines.join("\n");
  }

  for (const row of rowData) {
    lines.push(row.tuple.join(","));
  }
  return lines.join("\n");
}

function updateSelectionPanel() {
  const image = currentImage();
  const rect = image?.selection;
  if (!image || !rect) {
    cancelSelectionDetailsWork();
    cancelSelectionMatrixCopy();
    selectionSummary.textContent = "No selection.";
    selectionMatrixText.value = "";
    copySelectionMatrixButton.disabled = true;
    return;
  }

  const rectKey = selectionRectKey(image, rect);
  const matrixKey = selectionMatrixKey(image, rect);
  if (
    selectionMatrixCopyInFlight &&
    (selectionMatrixCopyInFlight.image !== image || selectionMatrixCopyInFlight.matrixKey !== matrixKey)
  ) {
    cancelSelectionMatrixCopy();
  }
  const cached = selectionDetailsCache.get(image);
  const stats = cached?.rectKey === rectKey ? cached.stats : null;
  const channels = valueChannels(image);
  const summaryLines = [
    `Image: ${image.name}`,
    `Rect: x ${rect.x}, y ${rect.y}, ${rect.width} x ${rect.height} px`,
    `Count: ${rect.width * rect.height}`,
    `Display: ${displayChannelLabel(image)}`
  ];

  if (stats) {
    summaryLines.push(
      `Min: ${formatChannelStats(stats.min, channels)}`,
      `Max: ${formatChannelStats(stats.max, channels)}`,
      `Average RGB: ${formatRgbStats(stats.average)}; Luminance ${formatNumber(stats.averageLuminance)}`
    );
  } else {
    summaryLines.push("Statistics: pending...");
  }
  selectionSummary.textContent = summaryLines.join("\n");
  const matrixReady = cached?.matrixKey === matrixKey;
  const nextMatrixText = matrixReady ? cached.matrix : "";
  if (selectionMatrixText.value !== nextMatrixText) {
    selectionMatrixText.value = nextMatrixText;
  }
  copySelectionMatrixButton.disabled = !matrixReady || Boolean(selectionMatrixCopyInFlight);

  const matchingJob = selectionDetailsInFlight?.image === image && selectionDetailsInFlight.matrixKey === matrixKey;
  if (activeDrag?.kind === "selectRect") {
    cancelSelectionDetailsWork();
  } else if ((!stats || cached?.matrixKey !== matrixKey) && !matchingJob) {
    scheduleSelectionDetails(image, rect, rectKey, matrixKey);
  }
}

// 統計値は alpha 乗算の有無で変わるので、キャッシュキーにもその状態を含める
function selectionRectKey(image, rect) {
  return `${rawSelectionRectKey(rect)}:${usesAlphaWeightedValues(image) ? "pma" : "straight"}`;
}

function rawSelectionRectKey(rect) {
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

function selectionMatrixKey(image, rect) {
  return `${rawSelectionRectKey(rect)}:${pickerValueMode.value}:${image.settings.channel}`;
}

function scheduleSelectionDetails(image, rect, rectKey, matrixKey) {
  cancelSelectionDetailsWork();
  const jobId = selectionJobId;
  const savedRect = { ...rect };
  const valueMode = pickerValueMode.value;
  const channels = valueChannels(image).map((channel) => channel.index);
  selectionDetailsInFlight = { image, rectKey, matrixKey, jobId };
  selectionDetailsTimer = setTimeout(() => {
    selectionDetailsTimer = null;
    if (activeDrag?.kind === "selectRect") {
      scheduleSelectionDetails(image, savedRect, rectKey, matrixKey);
      return;
    }
    if (!selectionJobIsCurrent(image, rectKey, matrixKey, jobId)) {
      return;
    }
    copySelectionPixelsInChunks(image, savedRect, rectKey, matrixKey, valueMode, channels, jobId);
  }, 120);
}

function cancelSelectionDetailsWork() {
  selectionJobId += 1;
  clearTimeout(selectionDetailsTimer);
  selectionDetailsTimer = null;
  if (selectionCopyFrame !== null) {
    cancelAnimationFrame(selectionCopyFrame);
    selectionCopyFrame = null;
  }
  selectionWorker?.terminate();
  selectionWorker = null;
  selectionDetailsInFlight = null;
}

function selectionJobIsCurrent(image, rectKey, matrixKey, jobId) {
  return (
    jobId === selectionJobId &&
    currentImage() === image &&
    image.selection &&
    selectionRectKey(image, image.selection) === rectKey &&
    selectionMatrixKey(image, image.selection) === matrixKey
  );
}

function copySelectionPixelsInChunks(image, rect, rectKey, matrixKey, valueMode, channels, jobId) {
  const pixels = new Float32Array(rect.width * rect.height * 4);
  let row = 0;
  const copyRows = () => {
    selectionCopyFrame = null;
    if (!selectionJobIsCurrent(image, rectKey, matrixKey, jobId)) {
      return;
    }
    const deadline = performance.now() + 2;
    do {
      const sourceStart = ((rect.y + row) * image.width + rect.x) * 4;
      const targetStart = row * rect.width * 4;
      pixels.set(image.pixels.subarray(sourceStart, sourceStart + rect.width * 4), targetStart);
      row += 1;
    } while (row < rect.height && performance.now() < deadline);

    if (row < rect.height) {
      selectionCopyFrame = requestAnimationFrame(copyRows);
      return;
    }
    runSelectionWorker(image, rect, rectKey, matrixKey, valueMode, channels, pixels, jobId);
  };
  selectionCopyFrame = requestAnimationFrame(copyRows);
}

function runSelectionWorker(image, rect, rectKey, matrixKey, valueMode, channels, pixels, jobId) {
  if (!selectionJobIsCurrent(image, rectKey, matrixKey, jobId)) {
    return;
  }
  try {
    selectionWorker = new Worker(new URL("./selection-worker.js?v=20260808-1", import.meta.url));
  } catch (error) {
    selectionDetailsInFlight = null;
    console.error("Selection worker could not start.", error);
    return;
  }

  selectionWorker.addEventListener("message", (event) => {
    if (!selectionJobIsCurrent(image, rectKey, matrixKey, jobId) || event.data.jobId !== jobId) {
      return;
    }
    if (event.data.kind === "stats") {
      selectionDetailsCache.set(image, {
        rectKey,
        stats: event.data.stats,
        pooled: event.data.pooled,
        matrixKey: null,
        matrix: ""
      });
      updateSelectionPanel();
      drawSelectionGraph();
      return;
    }
    if (event.data.kind === "preview") {
      const cached = selectionDetailsCache.get(image);
      selectionDetailsCache.set(image, {
        rectKey,
        stats: cached?.rectKey === rectKey ? cached.stats : event.data.stats,
        pooled: cached?.rectKey === rectKey ? cached.pooled : event.data.pooled,
        matrixKey,
        matrix: event.data.matrix ?? ""
      });
      selectionDetailsInFlight = null;
      selectionWorker?.terminate();
      selectionWorker = null;
      updateSelectionPanel();
    }
  });
  selectionWorker.addEventListener("error", (error) => {
    if (jobId === selectionJobId) {
      selectionDetailsInFlight = null;
      selectionWorker?.terminate();
      selectionWorker = null;
    }
    console.error("Selection worker failed.", error);
  });
  selectionWorker.postMessage({
    jobId,
    pixels: pixels.buffer,
    width: rect.width,
    height: rect.height,
    valueMode,
    channels,
    alphaWeighted: usesAlphaWeightedValues(image),
    previewRows: selectionMatrixPreviewRows,
    previewColumns: selectionMatrixPreviewColumns
  }, [pixels.buffer]);
}
function copyFullSelectionMatrix() {
  const image = currentImage();
  const rect = image?.selection;
  if (!image || !rect || selectionMatrixCopyInFlight) {
    return;
  }

  cancelSelectionMatrixCopy();
  const savedRect = { ...rect };
  const rectKey = selectionRectKey(image, savedRect);
  const matrixKey = selectionMatrixKey(image, savedRect);
  const valueMode = pickerValueMode.value;
  const channels = valueChannels(image).map((channel) => channel.index);
  const jobId = selectionMatrixCopyJobId;
  const pixels = new Float32Array(savedRect.width * savedRect.height * 4);
  let row = 0;

  selectionMatrixCopyInFlight = { image, rectKey, matrixKey, jobId };
  copySelectionMatrixButton.disabled = true;
  copySelectionMatrixButton.textContent = "Preparing...";

  const copyRows = () => {
    selectionMatrixCopyFrame = null;
    if (!selectionMatrixCopyJobIsCurrent(image, matrixKey, jobId)) {
      cancelSelectionMatrixCopy();
      updateSelectionPanel();
      return;
    }
    const deadline = performance.now() + 2;
    do {
      const sourceStart = ((savedRect.y + row) * image.width + savedRect.x) * 4;
      const targetStart = row * savedRect.width * 4;
      pixels.set(image.pixels.subarray(sourceStart, sourceStart + savedRect.width * 4), targetStart);
      row += 1;
    } while (row < savedRect.height && performance.now() < deadline);

    if (row < savedRect.height) {
      selectionMatrixCopyFrame = requestAnimationFrame(copyRows);
      return;
    }
    runFullSelectionMatrixWorker(image, savedRect, matrixKey, valueMode, channels, pixels, jobId);
  };
  selectionMatrixCopyFrame = requestAnimationFrame(copyRows);
}

function selectionMatrixCopyJobIsCurrent(image, matrixKey, jobId) {
  return (
    jobId === selectionMatrixCopyJobId &&
    selectionMatrixCopyInFlight?.jobId === jobId &&
    currentImage() === image &&
    image.selection &&
    selectionMatrixKey(image, image.selection) === matrixKey
  );
}

function runFullSelectionMatrixWorker(image, rect, matrixKey, valueMode, channels, pixels, jobId) {
  if (!selectionMatrixCopyJobIsCurrent(image, matrixKey, jobId)) {
    return;
  }
  try {
    selectionMatrixCopyWorker = new Worker(new URL("./selection-worker.js?v=20260808-1", import.meta.url));
  } catch (error) {
    console.error("Matrix copy worker could not start.", error);
    fileHint.textContent = "Matrix copy failed.";
    finishSelectionMatrixCopy(jobId);
    return;
  }

  selectionMatrixCopyWorker.addEventListener("message", (event) => {
    if (
      event.data.kind !== "fullMatrix" ||
      event.data.jobId !== jobId ||
      !selectionMatrixCopyJobIsCurrent(image, matrixKey, jobId)
    ) {
      return;
    }
    void writeFullSelectionMatrixToClipboard(event.data.matrix, rect, jobId);
  });
  selectionMatrixCopyWorker.addEventListener("error", (error) => {
    if (jobId !== selectionMatrixCopyJobId) {
      return;
    }
    console.error("Matrix copy worker failed.", error);
    fileHint.textContent = "Matrix copy failed.";
    finishSelectionMatrixCopy(jobId);
  });
  selectionMatrixCopyWorker.postMessage({
    task: "matrix",
    jobId,
    pixels: pixels.buffer,
    width: rect.width,
    height: rect.height,
    valueMode,
    channels,
    alphaWeighted: usesAlphaWeightedValues(image)
  }, [pixels.buffer]);
}

async function writeFullSelectionMatrixToClipboard(matrix, rect, jobId) {
  try {
    await navigator.clipboard.writeText(matrix);
    fileHint.textContent = `Copied Matrix ${rect.width} x ${rect.height}`;
  } catch (error) {
    const preview = selectionMatrixText.value;
    selectionMatrixText.value = matrix;
    selectionMatrixText.select();
    const copied = document.execCommand("copy");
    selectionMatrixText.value = preview;
    if (copied) {
      fileHint.textContent = `Copied Matrix ${rect.width} x ${rect.height}`;
    } else {
      console.error("Matrix clipboard write failed.", error);
      fileHint.textContent = "Matrix copy failed.";
    }
  } finally {
    finishSelectionMatrixCopy(jobId);
  }
}

function finishSelectionMatrixCopy(jobId) {
  if (selectionMatrixCopyInFlight?.jobId !== jobId) {
    return;
  }
  selectionMatrixCopyWorker?.terminate();
  selectionMatrixCopyWorker = null;
  selectionMatrixCopyInFlight = null;
  copySelectionMatrixButton.textContent = "Copy Matrix";
  updateSelectionPanel();
}

function cancelSelectionMatrixCopy() {
  selectionMatrixCopyJobId += 1;
  if (selectionMatrixCopyFrame !== null) {
    cancelAnimationFrame(selectionMatrixCopyFrame);
    selectionMatrixCopyFrame = null;
  }
  selectionMatrixCopyWorker?.terminate();
  selectionMatrixCopyWorker = null;
  selectionMatrixCopyInFlight = null;
  copySelectionMatrixButton.textContent = "Copy Matrix";
}
function formatRgbStats(values) {
  return `R ${formatNumber(values[0])}, G ${formatNumber(values[1])}, B ${formatNumber(values[2])}`;
}

function selectionCsvText(image, rect) {
  const mode = pickerValueMode.value;
  const channels = valueChannels(image);
  const lines = [["x", "y", "mode", "display", ...channels.map((channel) => channel.key)].join(",")];
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      lines.push([
        rect.x + x,
        rect.y + y,
        mode,
        displayChannelLabel(image),
        ...pixelTupleForMode(image, rect.x + x, rect.y + y, mode, channels)
      ].join(","));
    }
  }
  return lines.join("\n");
}

function requestSelectionGraphDraw() {
  if (graphRafPending) {
    return;
  }
  graphRafPending = true;
  requestAnimationFrame(() => {
    graphRafPending = false;
    drawSelectionGraph();
  });
}

function updateLogDisplayButton() {
  logDisplayButton.classList.toggle("active", logDisplayMode);
  logDisplayButton.title = logDisplayMode
    ? "Log color scale (click for Linear)"
    : "Linear color scale (click for Log)";
}

function drawSelectionGraph() {
  const image = currentImage();
  const rect = image?.selection;
  if (!image || !rect) {
    selectionGraphPanel.classList.add("hidden");
    return;
  }

  selectionGraphPanel.classList.remove("hidden");
  const sampling = selectionGraphSampling(rect);
  const samplingLabel = sampling.stepped ? "" : sampling.downsampled ? " · Downsampled" : " · Interpolated";
  const graphLabel = `${rect.width} x ${rect.height} px ${graphModeLabel(image)}${samplingLabel}`;
  selectionGraphLabel.textContent = graphLabel;
  selectionGraphLabel.title = graphLabel;
  if (selectionGraphPanel.classList.contains("collapsed")) {
    return;
  }

  const bounds = selectionGraphCanvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));

  if (selectionGraphCanvas.width !== pixelWidth || selectionGraphCanvas.height !== pixelHeight) {
    selectionGraphCanvas.width = pixelWidth;
    selectionGraphCanvas.height = pixelHeight;
  }

  graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  graphCtx.clearRect(0, 0, width, height);
  graphCtx.fillStyle = "#07090c";
  graphCtx.fillRect(0, 0, width, height);

  const samples = selectionGraphSamples(image, rect, sampling);
  if (!samples.values.length) {
    return;
  }

  const statistics = activeDrag?.kind === "selectRect" ? null : selectionGraphStatistics(image, rect);
  const min = statistics?.min ?? samples.min;
  const max = statistics?.max ?? samples.max;
  const normalize = graphValueNormalizer(min, max, logDisplayMode ? "log" : "linear");
  const projector = makeGraphProjector(samples, rect, width, height, normalize);

  graphCtx.save();
  drawGraphBase(samples, projector);

  if (samples.stepped) {
    drawSteppedGraph(samples, projector, normalize, min);
  } else {
    drawInterpolatedGraph(samples, projector, normalize);
  }

  drawGraphLegend(width, height, min, max, statistics, normalize);
  drawGraphSamplingNotice(sampling);
  graphCtx.restore();
}

// Maps a raw value to a 0-1 position for color/height, either linearly or on a log10 scale.
function graphValueNormalizer(min, max, mode) {
  if (mode === "log") {
    const epsilon = Math.max(1e-6, Math.abs(max) * 1e-6);
    const logMin = Math.log10(Math.max(min, 0) + epsilon);
    const logMax = Math.log10(Math.max(max, 0) + epsilon);
    const logRange = (logMax - logMin) || 1;
    return (value) => {
      const safeValue = Number.isFinite(value) ? Math.max(value, 0) : 0;
      return clamp01((Math.log10(safeValue + epsilon) - logMin) / logRange);
    };
  }
  const range = (max - min) || 1;
  return (value) => clamp01(((Number.isFinite(value) ? value : min) - min) / range);
}

function selectionGraphSampling(rect) {
  const stepped = !activeDrag && rect.width <= 64 && rect.height <= 64;
  const sampleLimit = activeDrag ? 20 : 64;
  const cols = stepped ? rect.width : Math.max(2, Math.min(sampleLimit, rect.width));
  const rows = stepped ? rect.height : Math.max(2, Math.min(sampleLimit, rect.height));
  return {
    stepped,
    cols,
    rows,
    downsampled: cols < rect.width || rows < rect.height
  };
}

function selectionGraphSamples(image, rect, sampling = selectionGraphSampling(rect)) {
  if (!activeDrag) {
    const cached = selectionDetailsCache.get(image);
    if (cached?.rectKey === selectionRectKey(image, rect) && cached.pooled) {
      const pooled = pooledGraphSamples(image, cached.pooled);
      if (pooled) {
        return { ...pooled, stepped: sampling.stepped };
      }
    }
  }

  const { stepped, cols, rows } = sampling;
  const values = [];
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < rows; row += 1) {
    const y = stepped
      ? rect.y + row
      : rect.y + Math.round((rect.height - 1) * (rows === 1 ? 0 : row / (rows - 1)));
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      const x = stepped
        ? rect.x + col
        : rect.x + Math.round((rect.width - 1) * (cols === 1 ? 0 : col / (cols - 1)));
      const value = graphPixelValue(image, x, y);
      line.push(value);
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    values.push(line);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }
  return { cols, rows, values, min, max, stepped };
}

// Averages each pooled cell's linear RGBA into the current channel/luminance value.
function pooledGraphSamples(image, pooled) {
  const { cols, rows, values } = pooled;
  if (!cols || !rows || !values?.length) {
    return null;
  }
  const mode = image.settings.channel;
  const grid = [];
  let min = Infinity;
  let max = -Infinity;
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      const index = (row * cols + col) * 4;
      const value = channelValueFromRgba(mode, values[index], values[index + 1], values[index + 2], values[index + 3]);
      line.push(value);
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    grid.push(line);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }
  return { cols, rows, values: grid, min, max };
}

function drawGraphSamplingNotice(sampling) {
  if (sampling.stepped) {
    return;
  }
  const label = sampling.downsampled
    ? `Downsampled: ${sampling.cols} x ${sampling.rows}`
    : "Interpolated";
  graphCtx.font = "10px Consolas, monospace";
  graphCtx.textAlign = "left";
  const x = 10;
  const y = 10;
  const width = Math.ceil(graphCtx.measureText(label).width) + 12;
  const height = 18;
  graphCtx.fillStyle = "rgba(50, 35, 5, 0.9)";
  graphCtx.fillRect(x, y, width, height);
  graphCtx.strokeStyle = "#e5a62b";
  graphCtx.lineWidth = 1;
  graphCtx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  graphCtx.fillStyle = "#ffd36b";
  graphCtx.fillText(label, x + 6, y + 12);
}

function selectionGraphStatistics(image, rect) {
  const cached = selectionDetailsCache.get(image);
  if (cached?.rectKey !== selectionRectKey(image, rect) || !cached.stats) {
    return null;
  }

  const stats = cached.stats;
  const mode = image.settings.channel;
  if (["r", "g", "b", "a"].includes(mode)) {
    const channel = { r: 0, g: 1, b: 2, a: 3 }[mode];
    return {
      min: stats.min[channel],
      max: stats.max[channel],
      average: stats.average[channel]
    };
  }
  return {
    min: stats.luminanceMin,
    max: stats.luminanceMax,
    average: stats.averageLuminance
  };
}
function graphPixelValue(image, x, y) {
  const linear = readDisplayedLinear(image, x, y);
  return channelValueFromRgba(image.settings.channel, linear[0], linear[1], linear[2], linear[3]);
}

function channelValueFromRgba(mode, r, g, b, a) {
  if (mode === "r") {
    return r;
  }
  if (mode === "g") {
    return g;
  }
  if (mode === "b") {
    return b;
  }
  if (mode === "a") {
    return a;
  }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function graphModeLabel(image) {
  const mode = image.settings.channel;
  if (mode === "r" || mode === "g" || mode === "b" || mode === "a") {
    return mode.toUpperCase();
  }
  return "Luminance";
}

function drawInterpolatedGraph(samples, projector, normalize) {
  const quads = [];
  for (let row = 0; row < samples.rows - 1; row += 1) {
    for (let col = 0; col < samples.cols - 1; col += 1) {
      const v00 = samples.values[row][col];
      const v10 = samples.values[row][col + 1];
      const v11 = samples.values[row + 1][col + 1];
      const v01 = samples.values[row + 1][col];
      const avg = (v00 + v10 + v11 + v01) / 4;
      quads.push({
        depth: graphFaceDepth(projector, col, row, col + 1, row + 1),
        color: graphColor(normalize(avg)),
        alpha: 1,
        stroke: "rgba(8, 12, 18, 0.36)",
        points: [
          projector.surface(col, row, v00),
          projector.surface(col + 1, row, v10),
          projector.surface(col + 1, row + 1, v11),
          projector.surface(col, row + 1, v01)
        ]
      });
    }
  }

  drawGraphFaces(quads, 0.6);
}

function drawSteppedGraph(samples, projector, normalize, min) {
  const faces = [];
  const valueAt = (col, row) => samples.values[row][col];

  for (let row = 0; row < samples.rows; row += 1) {
    for (let col = 0; col < samples.cols; col += 1) {
      const value = valueAt(col, row);
      addSteppedTopFace(faces, projector, col, row, value, normalize(value));

      if (col === 0) {
        addSteppedSideFace(faces, projector, col, row, col, row + 1, value, min, normalize(value));
      }
      if (row === 0) {
        addSteppedSideFace(faces, projector, col, row, col + 1, row, value, min, normalize(value));
      }
      if (col === samples.cols - 1) {
        addSteppedSideFace(faces, projector, col + 1, row, col + 1, row + 1, value, min, normalize(value));
      } else {
        const next = valueAt(col + 1, row);
        if (Math.abs(next - value) > 1e-12) {
          addSteppedSideFace(faces, projector, col + 1, row, col + 1, row + 1, value, next, normalize((value + next) / 2));
        }
      }
      if (row === samples.rows - 1) {
        addSteppedSideFace(faces, projector, col, row + 1, col + 1, row + 1, value, min, normalize(value));
      } else {
        const next = valueAt(col, row + 1);
        if (Math.abs(next - value) > 1e-12) {
          addSteppedSideFace(faces, projector, col, row + 1, col + 1, row + 1, value, next, normalize((value + next) / 2));
        }
      }
    }
  }

  drawGraphFaces(faces, 0.9);
}

function addSteppedTopFace(faces, projector, col, row, value, colorValue) {
  faces.push({
    depth: graphFaceDepth(projector, col, row, col + 1, row + 1),
    color: graphColor(colorValue),
    alpha: 1,
    stroke: "rgba(5, 8, 12, 0.62)",
    points: [
      projector.surface(col, row, value),
      projector.surface(col + 1, row, value),
      projector.surface(col + 1, row + 1, value),
      projector.surface(col, row + 1, value)
    ]
  });
}

function addSteppedSideFace(faces, projector, x0, y0, x1, y1, valueA, valueB, colorValue) {
  faces.push({
    depth: graphFaceDepth(projector, x0, y0, x1, y1),
    color: graphColor(colorValue),
    alpha: 0.72,
    stroke: "rgba(5, 8, 12, 0.46)",
    points: [
      projector.surface(x0, y0, valueA),
      projector.surface(x1, y1, valueA),
      projector.surface(x1, y1, valueB),
      projector.surface(x0, y0, valueB)
    ]
  });
}

function graphFaceDepth(projector, x0, y0, x1, y1) {
  return projector.depth(x0, y0) + projector.depth(x1, y0) + projector.depth(x1, y1) + projector.depth(x0, y1);
}

function drawGraphFaces(faces, lineWidth) {
  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    graphCtx.beginPath();
    graphCtx.moveTo(face.points[0].x, face.points[0].y);
    for (const point of face.points.slice(1)) {
      graphCtx.lineTo(point.x, point.y);
    }
    graphCtx.closePath();
    graphCtx.globalAlpha = face.alpha;
    graphCtx.fillStyle = face.color;
    graphCtx.fill();
    graphCtx.globalAlpha = 1;
    graphCtx.strokeStyle = face.stroke;
    graphCtx.lineWidth = lineWidth;
    graphCtx.stroke();
  }
}

function makeGraphProjector(samples, rect, width, height, normalize) {
  const plot = {
    left: 12,
    top: 12,
    right: Math.max(64, width - 54),
    bottom: Math.max(40, height - 18)
  };
  const aspect = rect.width / rect.height;
  const worldWidth = aspect >= 1 ? 1.7 : clamp(1.7 * aspect, 0.42, 1.7);
  const worldDepth = aspect >= 1 ? clamp(1.7 / aspect, 0.42, 1.7) : 1.7;
  const baseWorldHeight = 0.78;
  const pointCols = samples.stepped ? samples.cols + 1 : samples.cols;
  const pointRows = samples.stepped ? samples.rows + 1 : samples.rows;
  const availableWidth = Math.max(20, plot.right - plot.left);
  const availableHeight = Math.max(20, plot.bottom - plot.top);

  const graphExtent = (worldHeight) => {
    const rawPoints = [];
    for (let row = 0; row < pointRows; row += 1) {
      for (let col = 0; col < pointCols; col += 1) {
        rawPoints.push(projectGraphPoint(col, row, 0, samples, worldWidth, worldDepth, worldHeight));
        rawPoints.push(projectGraphPoint(col, row, 1, samples, worldWidth, worldDepth, worldHeight));
      }
    }
    return rawPoints.reduce((result, point) => ({
      minX: Math.min(result.minX, point.x),
      maxX: Math.max(result.maxX, point.x),
      minY: Math.min(result.minY, point.y),
      maxY: Math.max(result.maxY, point.y)
    }), {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity
    });
  };

  let worldHeight = baseWorldHeight;
  let extent = graphExtent(worldHeight);
  const baseExtentWidth = Math.max(0.001, extent.maxX - extent.minX);
  const baseExtentHeight = Math.max(0.001, extent.maxY - extent.minY);
  const scaleFromWidth = availableWidth / baseExtentWidth * 0.92;
  const projectedValueAxis = Math.sin(graphView.pitch);

  if (projectedValueAxis > 0.18 && baseExtentHeight * scaleFromWidth < availableHeight * 0.82) {
    const targetExtentHeight = availableHeight * 0.92 / scaleFromWidth;
    let low = baseWorldHeight;
    let high = baseWorldHeight;
    while (graphExtent(high).maxY - graphExtent(high).minY < targetExtentHeight && high < 12) {
      high *= 1.5;
    }
    for (let i = 0; i < 16; i += 1) {
      const middle = (low + high) / 2;
      const middleExtent = graphExtent(middle);
      if (middleExtent.maxY - middleExtent.minY < targetExtentHeight) {
        low = middle;
      } else {
        high = middle;
      }
    }
    worldHeight = high;
    extent = graphExtent(worldHeight);
  }

  const extentWidth = Math.max(0.001, extent.maxX - extent.minX);
  const extentHeight = Math.max(0.001, extent.maxY - extent.minY);
  const scale = Math.min(
    availableWidth / extentWidth,
    availableHeight / extentHeight
  ) * 0.92;
  const offsetX = plot.left + availableWidth / 2 - ((extent.minX + extent.maxX) / 2) * scale;
  const offsetY = plot.top + availableHeight / 2 - ((extent.minY + extent.maxY) / 2) * scale;
  const toCanvas = (point) => ({
    x: offsetX + point.x * scale,
    y: offsetY + point.y * scale
  });

  return {
    base: (col, row) => toCanvas(projectGraphPoint(col, row, 0, samples, worldWidth, worldDepth, worldHeight)),
    surface: (col, row, value) => toCanvas(projectGraphPoint(col, row, normalize(value), samples, worldWidth, worldDepth, worldHeight)),
    depth: (col, row) => graphWorldPoint(col, row, samples, worldWidth, worldDepth).viewDepth
  };
}

function projectGraphPoint(col, row, zRatio, samples, worldWidth, worldDepth, worldHeight) {
  const point = graphWorldPoint(col, row, samples, worldWidth, worldDepth);
  const z = zRatio * worldHeight;
  return {
    x: point.viewX,
    y: point.viewY * Math.cos(graphView.pitch) - z * Math.sin(graphView.pitch)
  };
}

function graphWorldPoint(col, row, samples, worldWidth, worldDepth) {
  const xDivisor = samples.stepped ? samples.cols : samples.cols - 1;
  const yDivisor = samples.stepped ? samples.rows : samples.rows - 1;
  const xRatio = xDivisor <= 0 ? 0 : col / xDivisor;
  const yRatio = yDivisor <= 0 ? 0 : row / yDivisor;
  const x = (xRatio - 0.5) * worldWidth;
  const y = (yRatio - 0.5) * worldDepth;
  const cos = Math.cos(graphView.yaw);
  const sin = Math.sin(graphView.yaw);
  return {
    viewX: x * cos - y * sin,
    viewY: x * sin + y * cos,
    viewDepth: x * sin + y * cos
  };
}

function drawGraphBase(samples, projector) {
  graphCtx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  graphCtx.lineWidth = 1;
  const maxRow = samples.stepped ? samples.rows : samples.rows - 1;
  const maxCol = samples.stepped ? samples.cols : samples.cols - 1;
  const rowStep = samples.stepped ? 1 : Math.max(1, Math.floor(maxRow / 6));
  for (let row = 0; row <= maxRow; row += rowStep) {
    const start = projector.base(0, row);
    const end = projector.base(maxCol, row);
    graphCtx.beginPath();
    graphCtx.moveTo(start.x, start.y);
    graphCtx.lineTo(end.x, end.y);
    graphCtx.stroke();
  }
  const colStep = samples.stepped ? 1 : Math.max(1, Math.floor(maxCol / 6));
  for (let col = 0; col <= maxCol; col += colStep) {
    const start = projector.base(col, 0);
    const end = projector.base(col, maxRow);
    graphCtx.beginPath();
    graphCtx.moveTo(start.x, start.y);
    graphCtx.lineTo(end.x, end.y);
    graphCtx.stroke();
  }
  graphCtx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  const corners = [
    projector.base(0, 0),
    projector.base(maxCol, 0),
    projector.base(maxCol, maxRow),
    projector.base(0, maxRow)
  ];
  graphCtx.beginPath();
  graphCtx.moveTo(corners[0].x, corners[0].y);
  for (const corner of corners.slice(1)) {
    graphCtx.lineTo(corner.x, corner.y);
  }
  graphCtx.closePath();
  graphCtx.stroke();
}

function drawGraphLegend(width, height, min, max, statistics = null, normalize = graphValueNormalizer(min, max, "linear")) {
  const barX = Math.max(20, width - 32);
  const barY = 32;
  const barW = 10;
  const barH = Math.max(36, height - 70);
  for (let y = 0; y < barH; y += 1) {
    graphCtx.fillStyle = graphColor(1 - y / Math.max(1, barH - 1));
    graphCtx.fillRect(barX, barY + y, barW, 1);
  }
  graphCtx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  graphCtx.strokeRect(barX + 0.5, barY + 0.5, barW, barH);
  graphCtx.fillStyle = "#d7dde5";
  graphCtx.font = "10px Consolas, monospace";
  graphCtx.textAlign = "right";
  graphCtx.fillText(formatNumber(max), barX - 4, barY + 8);
  graphCtx.fillText(formatNumber(min), barX - 4, barY + barH);

  if (!statistics) {
    return;
  }
  const markers = [
    { label: "Avg", value: statistics.average, color: "#ffffff" }
  ].map((marker) => ({
    ...marker,
    y: barY + (1 - normalize(marker.value)) * barH,
    labelY: clamp(barY + (1 - normalize(marker.value)) * barH + 3, barY + 20, barY + barH - 10)
  }));

  for (const marker of markers) {
    graphCtx.strokeStyle = marker.color;
    graphCtx.fillStyle = marker.color;
    graphCtx.lineWidth = 1.5;
    graphCtx.beginPath();
    graphCtx.moveTo(barX - 2, marker.y);
    graphCtx.lineTo(barX + barW + 3, marker.y);
    graphCtx.stroke();
    graphCtx.lineWidth = 1;
    graphCtx.beginPath();
    graphCtx.moveTo(barX - 5, marker.labelY - 3);
    graphCtx.lineTo(barX - 2, marker.y);
    graphCtx.stroke();
    graphCtx.fillText(`${marker.label} ${formatNumber(marker.value)}`, barX - 7, marker.labelY);
  }
}
function graphColor(value) {
  const t = clamp01(value);
  const stops = [
    [0, 0, 70],
    [0, 74, 255],
    [0, 220, 255],
    [0, 210, 72],
    [255, 238, 0],
    [255, 0, 0]
  ];
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * local);
  const g = Math.round(a[1] + (b[1] - a[1]) * local);
  const blue = Math.round(a[2] + (b[2] - a[2]) * local);
  return `rgb(${r} ${g} ${blue})`;
}

function forEachPixelInRect(image, rect, callback) {
  const alphaWeighted = usesAlphaWeightedValues(image);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const index = ((rect.y + y) * image.width + rect.x + x) * 4;
      const alpha = image.pixels[index + 3];
      const scale = alphaWeighted ? alpha : 1;
      callback([
        image.pixels[index] * scale,
        image.pixels[index + 1] * scale,
        image.pixels[index + 2] * scale,
        alpha
      ], rect.x + x, rect.y + y);
    }
  }
}

function pixelTupleForMode(image, x, y, mode, channels = valueChannels(image)) {
  return valueTupleForMode(valuesFromLinear(readDisplayedLinear(image, x, y)), mode, channels);
}

// RGBA 表示ではキャンバス上で色に alpha が乗った状態（黒背景との合成結果）が見えているため、
// 値の取得も alpha 乗算後にそろえる。RGB / 単チャンネル表示は alpha を乗算しない。
function usesAlphaWeightedValues(image) {
  return image.settings.channel === "rgba";
}

function readDisplayedLinear(image, x, y) {
  const index = (y * image.width + x) * 4;
  const alpha = image.pixels[index + 3];
  const scale = usesAlphaWeightedValues(image) ? alpha : 1;
  return [
    image.pixels[index] * scale,
    image.pixels[index + 1] * scale,
    image.pixels[index + 2] * scale,
    alpha
  ];
}

function valuesFromLinear(linear) {
  const srgb = [
    linearToSrgb(linear[0]),
    linearToSrgb(linear[1]),
    linearToSrgb(linear[2]),
    linear[3]
  ];
  const srgb255 = [
    Math.round(clamp01(srgb[0]) * 255),
    Math.round(clamp01(srgb[1]) * 255),
    Math.round(clamp01(srgb[2]) * 255),
    Math.round(clamp01(srgb[3]) * 255)
  ];
  return { linear, srgb, srgb255 };
}

function csvCell(value) {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function pickerValues(image, picker) {
  return valuesFromLinear(readDisplayedLinear(image, picker.x, picker.y));
}

function formatPickerValue(image, values) {
  const tuple = valueTupleForMode(values, pickerValueMode.value, valueChannels(image));
  return tuple.join(", ");
}

function valueTupleForMode(values, mode, channels = allDisplayChannels()) {
  const source = valuesForMode(values, mode);
  return channels.map((channel) => source[channel.index]);
}

function valuesForMode(values, mode) {
  if (mode === "srgb255") {
    return values.srgb255;
  }
  if (mode === "srgb") {
    return values.srgb.map(formatNumber);
  }
  return values.linear.map(formatNumber);
}

function valueChannels(image) {
  const channels = allDisplayChannels();
  const mode = image.settings.channel;
  if (mode === "r") {
    return [channels[0]];
  }
  if (mode === "g") {
    return [channels[1]];
  }
  if (mode === "b") {
    return [channels[2]];
  }
  if (mode === "a") {
    return [channels[3]];
  }
  if (mode === "rgb") {
    return channels.slice(0, 3);
  }
  return channels;
}

function allDisplayChannels() {
  return [
    { key: "r", label: "R", index: 0 },
    { key: "g", label: "G", index: 1 },
    { key: "b", label: "B", index: 2 },
    { key: "a", label: "A", index: 3 }
  ];
}

function unionChannels(channelGroups) {
  const used = new Set(channelGroups.flat().map((channel) => channel.key));
  return allDisplayChannels().filter((channel) => used.has(channel.key));
}

function displayChannelLabel(image) {
  const mode = image.settings.channel;
  if (mode === "rgb") {
    return "RGB";
  }
  if (mode === "rgba") {
    // RGBA 表示では RGB に alpha を乗算した値を出しているので、そのことを明示する
    return "RGBA (RGB x alpha)";
  }
  return mode.toUpperCase();
}

function formatChannelStats(values, channels) {
  return channels.map((channel) => `${channel.label} ${formatNumber(values[channel.index])}`).join(", ");
}

function sampleCssColor(image, linear) {
  const display = displayChannels(linear, image.settings.channel);
  const r = Math.round(clamp01(linearToSrgb(display[0])) * 255);
  const g = Math.round(clamp01(linearToSrgb(display[1])) * 255);
  const b = Math.round(clamp01(linearToSrgb(display[2])) * 255);
  return `rgb(${r} ${g} ${b})`;
}

function allPickers() {
  return images.flatMap((image) => image.pickers.map((picker) => ({ image, picker })));
}

function nextPickerColor() {
  const used = new Set(allPickers().map(({ picker }) => picker.color));
  return pickerColors.find((color) => !used.has(color)) || pickerColors[0];
}

function updatePickerCursor() {
  for (const image of images) {
    image.elements?.canvas.classList.toggle("picker-mode", pickerMode);
  }
}

function computeRange(pixels) {
  // 読み込みのたびに全画素を走るので、min/max は配列ではなくローカル変数で回す
  let minR = Infinity;
  let minG = Infinity;
  let minB = Infinity;
  let minA = Infinity;
  let maxR = -Infinity;
  let maxG = -Infinity;
  let maxB = -Infinity;
  let maxA = -Infinity;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    // ±Infinity / NaN は範囲に含めない（EXR にはそのまま入っていることがある）
    if (Number.isFinite(r)) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    if (Number.isFinite(g)) {
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
    }
    if (Number.isFinite(b)) {
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
    if (Number.isFinite(a)) {
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
    }
  }

  const min = [minR, minG, minB, minA];
  const max = [maxR, maxG, maxB, maxA];

  for (let channel = 0; channel < 4; channel += 1) {
    if (min[channel] === Infinity) {
      min[channel] = 0;
      max[channel] = 0;
    }
  }

  return {
    min,
    max,
    rgbMin: Math.min(min[0], min[1], min[2]),
    rgbMax: Math.max(max[0], max[1], max[2])
  };
}

function getDisplayNormalizationRange(image) {
  const channelIndex = { r: 0, g: 1, b: 2, a: 3 }[image.settings.channel];

  // R/G/B/A単独表示時はそのチャンネル専用の範囲を使う
  if (channelIndex !== undefined) {
    return {
      min: image.range.min[channelIndex],
      max: image.range.max[channelIndex]
    };
  }

  // RGB/RGBA表示はRGB全体の範囲
  return {
    min: image.range.rgbMin,
    max: image.range.rgbMax
  };
}

function updateSettingsPanel() {
  const image = currentImage();
  emptySettings.classList.toggle("hidden", Boolean(image));
  settingsForm.classList.toggle("hidden", !image);
  if (!image) {
    return;
  }

  zoomSelect.value = matchingZoomValue(image);
  filterSelect.value = image.settings.filter;
  autoLevelInput.checked = image.settings.autoLevel;
  brightnessInput.value = String(image.settings.brightness);
  updateSaveFormatOptions(image);
  metaName.textContent = image.name;
  metaSize.textContent = `${image.width} x ${image.height}`;
  metaType.textContent = `${image.type} / ${image.sourceFormat}`;
  const normalizationRange = getDisplayNormalizationRange(image);
  metaRange.textContent = `${formatNumber(normalizationRange.min)} - ${formatNumber(normalizationRange.max)}`;

  for (const button of channelButtons.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.channel === image.settings.channel);
  }
}

function updateSaveFormatOptions(image) {
  const allowed = allowedSaveFormats(image);
  for (const option of saveFormatSelect.options) {
    const enabled = allowed.includes(option.value);
    option.hidden = !enabled;
    option.disabled = !enabled;
  }
  if (!allowed.includes(saveFormatSelect.value)) {
    saveFormatSelect.value = allowed[0];
  }
}

function allowedSaveFormats(image) {
  if (image.sourceFormat === "exr") {
    return ["exr"];
  }
  if (image.sourceFormat === "hdr") {
    return ["hdr", "exr"];
  }
  return ["png", "jpeg", "webp"];
}

function matchingZoomValue(image) {
  if (image.view.fit) {
    return "fit";
  }
  const presets = [1, 2, 4, 8, 16, 32];
  const match = presets.find((value) => Math.abs(value - image.view.scale) < 0.0001);
  return match ? String(match) : "custom";
}

function requestRender() {
  if (rafPending) {
    return;
  }
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    for (const image of images) {
      renderImage(image);
    }
    updateViewState();
    drawSelectionGraph();
  });
}

function renderImage(image) {
  if (!image.elements) {
    return;
  }
  const { canvas, ctx } = image.elements;
  const { width, height } = canvasCssSize(image);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    if (image.view.fit) {
      fitImageToWindow(image, false);
    }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  ensureDisplayCanvas(image);
  ctx.imageSmoothingEnabled = shouldSmooth(image);
  ctx.drawImage(
    image.displayCanvas,
    image.view.offsetX,
    image.view.offsetY,
    image.width * image.view.scale,
    image.height * image.view.scale
  );
  drawPixelGrid(image, ctx, width, height);
  drawPickers(image, ctx);
  drawSelection(image, ctx);
}

function drawPixelGrid(image, ctx, canvasWidth, canvasHeight) {
  if (image.view.scale < 12) {
    return;
  }

  const scale = image.view.scale;
  const offsetX = image.view.offsetX;
  const offsetY = image.view.offsetY;
  const firstX = Math.max(0, Math.floor(-offsetX / scale));
  const lastX = Math.min(image.width, Math.ceil((canvasWidth - offsetX) / scale));
  const firstY = Math.max(0, Math.floor(-offsetY / scale));
  const lastY = Math.min(image.height, Math.ceil((canvasHeight - offsetY) / scale));
  if (firstX > lastX || firstY > lastY) {
    return;
  }

  const imageLeft = offsetX + firstX * scale;
  const imageTop = offsetY + firstY * scale;
  const imageRight = offsetX + lastX * scale;
  const imageBottom = offsetY + lastY * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(imageLeft, imageTop, imageRight - imageLeft, imageBottom - imageTop);
  ctx.clip();
  ctx.beginPath();
  for (let x = firstX; x <= lastX; x += 1) {
    const screenX = Math.round(offsetX + x * scale) + 0.5;
    ctx.moveTo(screenX, imageTop);
    ctx.lineTo(screenX, imageBottom);
  }
  for (let y = firstY; y <= lastY; y += 1) {
    const screenY = Math.round(offsetY + y * scale) + 0.5;
    ctx.moveTo(imageLeft, screenY);
    ctx.lineTo(imageRight, screenY);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.62)";
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
  ctx.setLineDash([2, 3]);
  ctx.stroke();
  ctx.restore();
}

function ensureDisplayCanvas(image) {
  if (image.displayCanvas && !image.displayDirty) {
    return;
  }

  const output = image.displayCanvas || document.createElement("canvas");
  output.width = image.width;
  output.height = image.height;
  const outputCtx = output.getContext("2d");
  const imageData = outputCtx.createImageData(image.width, image.height);
  const normalizationRange = getDisplayNormalizationRange(image);
  const normalizationWidth = normalizationRange.max - normalizationRange.min;
  const brightness = image.settings.brightness;
  const logNormalize = logDisplayMode
    ? graphValueNormalizer(normalizationRange.min, normalizationRange.max, "log")
    : null;

  // チャンネル切り替えのたびに全画素を処理するので、分岐と配列確保はループの外に出す
  const target = imageData.data;
  const pixels = image.pixels;
  const mode = image.settings.channel;
  const autoLevel = image.settings.autoLevel && normalizationWidth > 0;
  const levelOffset = normalizationRange.min;
  const levelScale = normalizationWidth > 0 ? 1 / normalizationWidth : 1;

  if (mode === "a") {
    // アルファ単独表示は sRGB 変換せずリニアのまま濃淡にする
    for (let i = 0, j = 0; i < pixels.length; i += 4, j += 4) {
      let alpha = pixels[i + 3];
      if (logNormalize) {
        alpha = logNormalize(alpha * brightness);
      } else if (autoLevel) {
        alpha = clamp01((alpha - levelOffset) * levelScale * brightness);
      } else {
        alpha = clamp01(alpha * brightness);
      }
      const alphaByte = Math.round(alpha * 255);
      target[j] = alphaByte;
      target[j + 1] = alphaByte;
      target[j + 2] = alphaByte;
      target[j + 3] = 255;
    }
  } else {
    // どのソースチャンネルを R/G/B に流すかを先に決めておく（単チャンネル表示はグレースケール）
    let sourceR = 0;
    let sourceG = 1;
    let sourceB = 2;
    if (mode === "r" || mode === "g" || mode === "b") {
      sourceR = mode === "r" ? 0 : mode === "g" ? 1 : 2;
      sourceG = sourceR;
      sourceB = sourceR;
    }
    const useSourceAlpha = mode === "rgba";

    for (let i = 0, j = 0; i < pixels.length; i += 4, j += 4) {
      if (logNormalize) {
        target[j] = Math.round(logNormalize(pixels[i + sourceR] * brightness) * 255);
        target[j + 1] = Math.round(logNormalize(pixels[i + sourceG] * brightness) * 255);
        target[j + 2] = Math.round(logNormalize(pixels[i + sourceB] * brightness) * 255);
      } else if (autoLevel) {
        target[j] = linearToSrgbByte((pixels[i + sourceR] - levelOffset) * levelScale * brightness);
        target[j + 1] = linearToSrgbByte((pixels[i + sourceG] - levelOffset) * levelScale * brightness);
        target[j + 2] = linearToSrgbByte((pixels[i + sourceB] - levelOffset) * levelScale * brightness);
      } else {
        target[j] = linearToSrgbByte(pixels[i + sourceR] * brightness);
        target[j + 1] = linearToSrgbByte(pixels[i + sourceG] * brightness);
        target[j + 2] = linearToSrgbByte(pixels[i + sourceB] * brightness);
      }
      target[j + 3] = useSourceAlpha ? Math.round(clamp01(pixels[i + 3]) * 255) : 255;
    }
  }

  outputCtx.putImageData(imageData, 0, 0);
  image.displayCanvas = output;
  image.displayDirty = false;
}

function displayChannels(source, mode) {
  const [r, g, b, a] = source;
  if (mode === "r") {
    return [r, r, r, 1];
  }
  if (mode === "g") {
    return [g, g, g, 1];
  }
  if (mode === "b") {
    return [b, b, b, 1];
  }
  if (mode === "a") {
    return [a, a, a, 1];
  }
  if (mode === "rgb") {
    return [r, g, b, 1];
  }
  return [r, g, b, a];
}

function shouldSmooth(image) {
  if (image.settings.filter === "nearest") {
    return false;
  }
  if (image.settings.filter === "linear") {
    return true;
  }
  return image.view.scale < 1;
}

function zoomAt(image, x, y, nextScale) {
  const scale = Math.min(256, Math.max(0.01, nextScale));
  const imageX = (x - image.view.offsetX) / image.view.scale;
  const imageY = (y - image.view.offsetY) / image.view.scale;
  image.view.scale = scale;
  image.view.offsetX = x - imageX * scale;
  image.view.offsetY = y - imageY * scale;
  image.view.fit = false;
  updateSettingsPanel();
  requestRender();
  scheduleSessionSave();
}

function fitImageToWindow(image, renderAfter = true) {
  const { width, height } = canvasCssSize(image);
  const scale = Math.min(width / image.width, height / image.height) * 0.94;
  image.view.scale = Math.max(0.01, scale);
  image.view.offsetX = (width - image.width * image.view.scale) / 2;
  image.view.offsetY = (height - image.height * image.view.scale) / 2;
  image.view.fit = true;
  updateSettingsPanel();
  if (renderAfter) {
    requestRender();
    scheduleSessionSave();
  }
}

function endImagePan(image, event) {
  if (!image.pan) {
    return;
  }
  if (event.pointerId === image.pan.pointerId) {
    image.elements.canvas.releasePointerCapture(event.pointerId);
  }
  image.pan = null;
  image.elements.canvas.classList.remove("panning");
  scheduleSessionSave();
}

function updatePixelReadout(image, event) {
  const pixel = pixelFromEvent(image, event);
  if (!pixel) {
    clearPixelReadout();
    return;
  }

  const linear = readDisplayedLinear(image, pixel.x, pixel.y);
  const srgb = [
    linearToSrgb(linear[0]),
    linearToSrgb(linear[1]),
    linearToSrgb(linear[2]),
    linear[3]
  ];

  pixelPosition.textContent = `x: ${pixel.x}, y: ${pixel.y}`;
  linearValue.textContent = `Linear: ${formatTuple(linear)}`;
  srgbValue.textContent = `sRGB: ${formatTuple(srgb)}`;
}

function pixelFromEvent(image, event, clampToImage = false) {
  const rect = image.elements.canvas.getBoundingClientRect();
  const viewX = event.clientX - rect.left;
  const viewY = event.clientY - rect.top;
  const x = Math.floor((viewX - image.view.offsetX) / image.view.scale);
  const y = Math.floor((viewY - image.view.offsetY) / image.view.scale);

  if (clampToImage) {
    return {
      x: clamp(x, 0, image.width - 1),
      y: clamp(y, 0, image.height - 1)
    };
  }
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return null;
  }
  return { x, y };
}

function clearPixelReadout() {
  pixelPosition.textContent = "x: -, y: -";
  linearValue.textContent = "Linear: -";
  srgbValue.textContent = "sRGB: -";
}

function updateViewState() {
  const image = currentImage();
  if (!image) {
    viewState.textContent = "-";
    return;
  }
  viewState.textContent = `${Math.round(image.view.scale * 100)}%`;
}

function currentImage() {
  return images.find((image) => image.id === selectedId) || null;
}

function canvasCssSize(image) {
  const rect = image.elements?.canvas.getBoundingClientRect();
  if (!rect) {
    return {
      width: Math.max(1, image.window.width),
      height: Math.max(1, image.window.height - 28)
    };
  }
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height)
  };
}

function readTextureValue(data, index) {
  if (data instanceof Uint16Array) {
    return halfToFloat(data[index]);
  }
  return data[index] ?? 0;
}

function halfToFloat(value) {
  const sign = (value & 0x8000) ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) {
    return sign * Math.pow(2, -14) * (fraction / 1024);
  }
  if (exponent === 31) {
    return fraction ? NaN : sign * Infinity;
  }
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

function srgbToLinear(value) {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

// 表示用の linear -> sRGB 8bit 変換。画素ごとに Math.pow を呼ぶと 2048x1024 で 500ms 以上
// かかるため、[0,1) を 65536 分割した LUT を引く。linearToSrgb は単調増加なので、
// bin の両端で出力バイトが一致すれば bin 内のどの値でも同じバイトになることが保証できる。
// 一致しない bin（全体の 0.39%）だけ従来どおり厳密計算するので、結果は Math.pow と完全一致する。
const SRGB_BYTE_BINS = 65536;
const srgbByteTable = new Uint8Array(SRGB_BYTE_BINS);
const srgbByteNeedsExact = new Uint8Array(SRGB_BYTE_BINS);

for (let bin = 0; bin < SRGB_BYTE_BINS; bin += 1) {
  const low = Math.round(linearToSrgb(bin / SRGB_BYTE_BINS) * 255);
  const high = Math.round(linearToSrgb((bin + 1) / SRGB_BYTE_BINS) * 255);
  srgbByteTable[bin] = low;
  srgbByteNeedsExact[bin] = low === high ? 0 : 1;
}

function linearToSrgbByte(value) {
  // clamp01 と同じく、Inf / NaN は 0 として扱う
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 255;
  }
  const bin = (value * SRGB_BYTE_BINS) | 0;
  return srgbByteNeedsExact[bin] ? Math.round(linearToSrgb(value) * 255) : srgbByteTable[bin];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function formatTuple(values) {
  return `R ${formatNumber(values[0])}, G ${formatNumber(values[1])}, B ${formatNumber(values[2])}, A ${formatNumber(values[3])}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value === 0) {
    return "0";
  }
  // Plain decimal notation (no scientific notation), keeping ~7 significant digits.
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.min(20, Math.max(0, 6 - magnitude));
  const text = value.toFixed(decimals);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
