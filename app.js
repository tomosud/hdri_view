import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { decodePng, isPngFile, pngTypeLabel } from "./png-decoder.js?v=20260809-7";
import { canOpenPngAsTiles, openPngRasterSource } from "./png-raster-source.js?v=20260809-2";
import { decodeTiff, openTiffRasterSource } from "./tiff-decoder.js?v=20260811-2";
import { decodeJpeg2000, openJpeg2000RasterSource } from "./jp2-decoder.js?v=20260809-6";
import { createBitmapRasterSource, createMemoryRasterSource, createSwitchableRasterSource, RASTER_TILE_SIZE } from "./raster-source.js?v=20260811-2";
import { openAvifRasterSource } from "./avif-raster-source.js?v=20260810-2";
import {
  MAX_VALUE_MATRIX_PIXELS,
  isValueMatrixText,
  parseGenericValueMatrix,
  parseValueMatrix,
  serializeInternalValueReference,
  serializeValueMatrix
} from "./clipboard-matrix.js?v=20260808-1";
import {
  DEFAULT_FILTER_CODE,
  DEFAULT_GENERATOR_CODE,
  GLSL_PRESETS,
  getGlslSupport,
  runGlslShader
} from "./glsl-runtime.js?v=20260809-7";
import { decodeGlslShareHash, encodeGlslShareHash } from "./glsl-share.js?v=20260809-3";

const fileInput = document.querySelector("#fileInput");
const fileHint = document.querySelector("#fileHint");
const newImageButton = document.querySelector("#newImageButton");
const glslPanel = document.querySelector("#glslPanel");
const glslTitleText = document.querySelector("#glslTitleText");
const glslCloseButton = document.querySelector("#glslCloseButton");
const glslInputLabel = document.querySelector("#glslInputLabel");
const glslWidthInput = document.querySelector("#glslWidth");
const glslHeightInput = document.querySelector("#glslHeight");
const glslMatchInputButton = document.querySelector("#glslMatchInput");
const glslPresetSelect = document.querySelector("#glslPreset");
const glslCodeInput = document.querySelector("#glslCode");
const glslStatus = document.querySelector("#glslStatus");
const glslResize = document.querySelector("#glslResize");
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
const hoveredPickerValue = document.querySelector("#hoveredPickerValue");
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
const minGlslPanelHeight = 300;
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
let selectedPickerId = null;
let hoveredPickerId = null;
let hoveredPickerUiPending = false;
let hoveredPickerUiScroll = false;
let internalClipboard = null;
const portableClipboardMatrixPixels = 512 * 512;
const maxInternalClipboardPixels = 4096 * 2048;
const maxLoadedPngPixels = 4096 * 4096;
let clipboardReadJobId = 0;
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
  const image = currentImage();
  if (image) {
    image.settings.logDisplay = !image.settings.logDisplay;
    image.displayDirty = true;
  } else {
    logDisplayMode = !logDisplayMode;
  }
  updateLogDisplayButton();
  requestRender();
  requestSelectionGraphDraw();
  scheduleSessionSave();
});

selectionSummary.addEventListener("pointerdown", (event) => event.stopPropagation());
selectionSummary.addEventListener("copy", (event) => event.stopPropagation());

downloadSelectionCsvButton.addEventListener("click", async () => {
  const image = currentImage();
  if (!image?.selection) {
    return;
  }
  const csv = await selectionCsvText(image, image.selection);
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
    selectedPickerId = null;
    hoveredPickerId = null;
    updatePickerPanel();
    requestRender();
    scheduleSessionSave();
  }
});

saveImageButton.addEventListener("click", () => {
  const image = currentImage();
  if (image) {
    void saveImage(image, saveFormatSelect.value).catch((error) => {
      console.error("Save failed.", error);
      fileHint.textContent = `Save failed: ${error?.message || error}`;
    });
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
  const pasteJobId = ++clipboardReadJobId;
  const payload = clipboardPastePayload(event.clipboardData);
  const candidate = decodeClipboardPaste(payload);
  if (candidate) {
    event.preventDefault();
    void applyClipboardPasteCandidate(candidate);
  } else if (shouldTryAsyncClipboardRead(payload)) {
    event.preventDefault();
    void pasteFromAsyncClipboard(pasteJobId);
  }
});

window.addEventListener("hashchange", () => {
  openGlslShareFromLocation();
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
  void copySelection(image, image.selection, event.clipboardData);
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
  const files = [];
  const seen = new Set();
  const addFile = (file) => {
    if (!file || !isSupportedClipboardFile(file)) {
      return;
    }
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (!seen.has(key)) {
      seen.add(key);
      files.push(file);
    }
  };
  for (const file of Array.from(clipboardData?.files || [])) {
    addFile(file);
  }
  for (const item of Array.from(clipboardData?.items || [])) {
    if (item.kind === "file") {
      addFile(item.getAsFile());
    }
  }
  return files;
}

function clipboardPastePayload(clipboardData) {
  let text = "";
  try {
    text = clipboardData?.getData("text/plain") || "";
  } catch {
    // Some browsers expose image files but deny text access. The file candidate still works.
  }
  return {
    text,
    files: clipboardImageFiles(clipboardData),
    types: Array.from(clipboardData?.types || [])
  };
}

const clipboardPasteDecoders = [
  {
    id: "hdri-value-matrix",
    decode(payload) {
      if (!isValueMatrixText(payload.text)) {
        return null;
      }
      return {
        kind: "pixels",
        source: "HDRI Value Matrix",
        image: parseValueMatrix(payload.text, {
          resolveInternal: (token) => internalClipboard?.token === token ? internalClipboard : null
        })
      };
    }
  },
  {
    id: "external-images",
    decode(payload) {
      return payload.files.length ? { kind: "files", files: payload.files } : null;
    }
  },
  {
    id: "generic-value-matrix",
    decode(payload) {
      const image = parseGenericValueMatrix(payload.text);
      return image ? { kind: "pixels", source: "value matrix", image } : null;
    }
  },
  {
    id: "internal-fallback",
    decode(payload) {
      const clipboardIsEmpty = !payload.text && payload.files.length === 0 && payload.types.length === 0;
      const asyncReadUnavailable = typeof navigator.clipboard?.read !== "function";
      return clipboardIsEmpty && asyncReadUnavailable && internalClipboard
        ? { kind: "pixels", source: "internal values", image: internalClipboard }
        : null;
    }
  }
];

function decodeClipboardPaste(payload) {
  for (const decoder of clipboardPasteDecoders) {
    try {
      const candidate = decoder.decode(payload);
      if (candidate) {
        return candidate;
      }
    } catch (error) {
      if (error?.code === "VALUE_MATRIX_INTERNAL_UNAVAILABLE" && payload.files.length > 0) {
        continue;
      }
      console.error(`Clipboard decoder failed: ${decoder.id}`, error);
      return { kind: "error", message: error?.message || String(error) };
    }
  }
  return null;
}

async function applyClipboardPasteCandidate(candidate) {
  if (candidate.kind === "error") {
    fileHint.textContent = `Paste failed: ${candidate.message}`;
    return;
  }
  if (candidate.kind === "files") {
    await openFiles(candidate.files, null, { embedded: true });
    return;
  }
  pasteClipboardPixels(candidate.image, candidate.source);
}

function shouldTryAsyncClipboardRead(payload) {
  return typeof navigator.clipboard?.read === "function" && (
    payload.types.length === 0 ||
    payload.types.some((type) =>
      type === "Files" || type.startsWith("image/") || type.includes("exr") || type.includes("radiance")
    )
  );
}

async function pasteFromAsyncClipboard(jobId) {
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    const seenFiles = new Set();
    let text = "";
    for (const [itemIndex, item] of items.entries()) {
      if (item.types.includes("text/plain") && !text) {
        try {
          text = await (await item.getType("text/plain")).text();
        } catch (error) {
          console.warn("Clipboard text/plain could not be read.", error);
        }
      }
      const imageTypes = item.types
        .filter((type) => type !== "text/plain")
        .sort((left, right) => clipboardMimePriority(left) - clipboardMimePriority(right));
      for (const type of imageTypes) {
        try {
          const blob = await item.getType(type);
          const file = await clipboardBlobAsImageFile(blob, type, itemIndex);
          if (!file) {
            continue;
          }
          const key = `${file.name}:${file.type}:${file.size}`;
          if (!seenFiles.has(key)) {
            seenFiles.add(key);
            files.push(file);
          }
          // A ClipboardItem may expose the same image in several MIME representations.
          // Use only the highest-priority supported representation from each item.
          break;
        } catch (error) {
          console.warn(`Clipboard type could not be read: ${type}`, error);
        }
      }
    }
    if (jobId !== clipboardReadJobId) {
      return;
    }
    const candidate = decodeClipboardPaste({
      text,
      files,
      types: items.flatMap((item) => item.types)
    });
    if (candidate) {
      await applyClipboardPasteCandidate(candidate);
    } else {
      fileHint.textContent = "Paste failed: no supported image or value data was found.";
    }
  } catch (error) {
    if (jobId !== clipboardReadJobId) {
      return;
    }
    console.error("Async clipboard read failed.", error);
    fileHint.textContent = `Paste failed: ${error?.message || "clipboard data could not be read"}`;
  }
}

function clipboardMimePriority(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("exr") || normalized.includes("radiance") || normalized.includes("hdr")) return 0;
  if (normalized === "application/octet-stream" || !normalized) return 1;
  if (normalized === "image/png") return 2;
  return normalized.startsWith("image/") ? 3 : 4;
}

async function clipboardBlobAsImageFile(blob, mimeType, index) {
  const normalizedType = String(mimeType || blob.type || "").toLowerCase();
  let extension = clipboardExtensionForMime(normalizedType);
  if (!extension && (normalizedType === "application/octet-stream" || !normalizedType)) {
    extension = await detectHdrClipboardExtension(blob);
  }
  if (!extension) {
    return null;
  }
  return new File([blob], `clipboard-${index + 1}.${extension}`, {
    type: blob.type || normalizedType,
    lastModified: Date.now()
  });
}

function clipboardExtensionForMime(type) {
  const extensions = new Map([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
    ["image/gif", "gif"],
    ["image/bmp", "bmp"],
    ["image/vnd.radiance", "hdr"],
    ["image/x-hdr", "hdr"],
    ["image/hdr", "hdr"],
    ["image/x-exr", "exr"],
    ["image/exr", "exr"],
    ["application/x-exr", "exr"]
  ]);
  return extensions.get(type) || null;
}

async function detectHdrClipboardExtension(blob) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (head.length >= 4 && head[0] === 0x76 && head[1] === 0x2f && head[2] === 0x31 && head[3] === 0x01) {
    return "exr";
  }
  const signature = new TextDecoder("ascii").decode(head);
  return signature.startsWith("#?RADIANCE") || signature.startsWith("#?RGBE") ? "hdr" : null;
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
  requestSelectionGraphDraw();
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
  requestSelectionGraphDraw();
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
  } else if (activeDrag.kind === "movePicker") {
    const pixel = pixelFromEvent(activeDrag.image, event, true);
    if (pixel) {
      const x = clamp(activeDrag.x + pixel.x - activeDrag.startPixel.x, 0, activeDrag.image.width - 1);
      const y = clamp(activeDrag.y + pixel.y - activeDrag.startPixel.y, 0, activeDrag.image.height - 1);
      if (x !== activeDrag.picker.x || y !== activeDrag.picker.y) {
        activeDrag.picker.x = x;
        activeDrag.picker.y = y;
        activeDrag.moved = true;
        requestHoveredPickerUi();
        requestRender();
      }
    }
  } else if (activeDrag.kind === "graphResize") {
    selectionGraphPanel.style.width = `${Math.max(minGraphWidth, activeDrag.width + dx)}px`;
    selectionGraphPanel.style.height = `${Math.max(minGraphHeight, activeDrag.height + dy)}px`;
    requestSelectionGraphDraw();
  } else if (activeDrag.kind === "glslResize") {
    const viewportRect = viewport.getBoundingClientRect();
    const maxHeight = Math.max(minGlslPanelHeight, viewportRect.bottom - activeDrag.top - 8);
    glslPanel.style.height = `${clamp(activeDrag.height + dy, minGlslPanelHeight, maxHeight)}px`;
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
      requestSelectionGraphDraw();
      requestRender();
    }
  } else if (activeDrag?.kind === "movePicker") {
    const { image, picker, moved } = activeDrag;
    try {
      image.elements.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    image.elements.canvas.classList.remove("picker-moving");
    updatePickerPanel();
    requestRender();
    if (moved) {
      fileHint.textContent = `Moved P${picker.id} to ${picker.x}, ${picker.y}`;
    }
  }
  activeDrag = null;
  if (completedDragKind === "selectRect") {
    updateSelectionPanel();
  }
  if (["selectRect", "graphResize", "graphRotate"].includes(completedDragKind)) {
    requestSelectionGraphDraw();
  }
  if (completedDragKind) {
    scheduleSessionSave();
  }
});

makeFloatingPanelDraggable(inspector);
makeFloatingPanelDraggable(pickerPanel);
makeFloatingPanelDraggable(selectionGraphPanel);
initGlslEditor();
updatePickerPanel();
updateLogDisplayButton();
requestRender();
requestSelectionGraphDraw();
queueMicrotask(initializeApp);

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
  if (extension === "tif" || extension === "tiff") {
    return loadTiffImage(file);
  }
  if (extension === "jp2" || extension === "j2k" || extension === "j2c") {
    return loadJpeg2000Image(file);
  }
  if (extension === "avif") {
    return loadAvifImage(file);
  }
  return loadRasterImage(file);
}

async function loadAvifImage(file) {
  try {
    const opened = await openAvifRasterSource(file, {
      onProgress: (progress, label) => {
        fileHint.textContent = `${file.name}: ${label || `${progress}%`}`;
      }
    });
    const hdr = opened.transfer === "pq" || opened.transfer === "hlg";
    const rangeLabel = opened.fullRange ? "full" : "limited";
    const unitLabel = opened.valueUnit === "nit" ? " · absolute nit" : "";
    return createImageRecord(
      file,
      opened.width,
      opened.height,
      `avif/${opened.frameFormat} · ${opened.primaries}/${opened.transfer}/${opened.matrix}/${rangeLabel}${unitLabel}`,
      null,
      "raster",
      {
        format: hdr ? "AVIF HDR" : "AVIF",
        bitDepth: `${opened.bitDepth}-bit`,
        rasterSource: opened.rasterSource,
        range: computeRange(opened.preview.pixels),
        overview: rasterOverview(opened.preview),
        hdr,
        logDisplay: false,
        valueUnit: opened.valueUnit,
        colorPrimaries: opened.primaries,
        transfer: opened.transfer,
        matrix: opened.matrix,
        fullRange: opened.fullRange
      }
    );
  } catch (error) {
    console.warn("Exact AVIF decode unavailable; using 8-bit Canvas compatibility path.", error);
    const record = await loadCanvasRasterImage(file);
    record.type = `${record.type} (AVIF Canvas compatibility; HDR values unavailable)`;
    return record;
  }
}

async function loadJpeg2000Image(file) {
  try {
    const opened = await openJpeg2000RasterSource(await file.arrayBuffer(), {
      onProgress: (progress, label) => {
        fileHint.textContent = `${file.name}: ${label || `${progress}%`}`;
      }
    });
    const channels = opened.components === 1 ? "gray" : "rgb";
    return createImageRecord(
      file,
      opened.width,
      opened.height,
      `jpeg2000/${channels}${opened.bitDepth}`,
      null,
      "raster",
      {
        format: opened.container,
        bitDepth: `${opened.bitDepth}-bit`,
        rasterSource: opened.rasterSource,
        range: computeRange(opened.preview.pixels),
        overview: rasterOverview(opened.preview)
      }
    );
  } catch (error) {
    console.warn("Full-resolution JPEG 2000 tiled source unavailable; using sub-resolution compatibility decode.", error);
  }
  const decoded = await decodeJpeg2000(await file.arrayBuffer(), {
    maxPixels: maxLoadedPngPixels,
    onProgress: (progress, label) => {
      fileHint.textContent = `${file.name}: ${label || `${progress}%`}`;
    }
  });
  const channels = decoded.components === 1 ? "gray" : "rgb";
  return createImageRecord(
    file,
    decoded.width,
    decoded.height,
    `jpeg2000/${channels}${decoded.bitDepth}`,
    decoded.pixels,
    "raster",
    {
      format: decoded.container,
      bitDepth: `${decoded.bitDepth}-bit`,
      sourceWidth: decoded.sourceWidth,
      sourceHeight: decoded.sourceHeight,
      downsample: decoded.downsample
    }
  );
}

async function loadTiffImage(file) {
  try {
    const opened = await openTiffRasterSource(file);
    return createImageRecord(
      file,
      opened.width,
      opened.height,
      `tiff/${opened.channels}${opened.bitDepth}${opened.accessMode === "direct-uncompressed-strips" ? " · direct strips" : ""}`,
      null,
      "raster",
      {
        format: "TIFF",
        bitDepth: opened.bitDepthLabel || `${opened.bitDepth}-bit`,
        rasterSource: opened.rasterSource,
        range: computeRange(opened.preview.pixels),
        overview: rasterOverview(opened.preview),
        hdr: opened.sampleFormat === 3
      }
    );
  } catch (error) {
    console.warn("TIFF tiled source unavailable; using compatibility decode.", error);
  }
  const decoded = await decodeTiff(await file.arrayBuffer(), {
    onProgress: (progress, label) => {
      fileHint.textContent = `${file.name}: ${label || `${progress}%`}`;
    }
  });
  return createImageRecord(
    file,
    decoded.width,
    decoded.height,
    `tiff/${decoded.channels}${decoded.bitDepth}`,
    decoded.pixels,
    "raster",
    { format: "TIFF", bitDepth: decoded.bitDepthLabel || `${decoded.bitDepth}-bit` }
  );
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
    // IHDRまでを先に見て、巨大な非インタレースPNGは全ファイルArrayBuffer化せずWorkerタイル経路へ送る
    const head = new Uint8Array(await file.slice(0, 29).arrayBuffer());
    if (!isPngFile(head)) {
      return null;
    }
    if (canOpenPngAsTiles(head, maxLoadedPngPixels)) {
      const header = pngHeaderMetadata(head);
      let thumbnail;
      try {
        thumbnail = await createPngThumbnail(file, header.width, header.height);
      } catch (error) {
        console.warn("PNG provisional thumbnail failed; waiting for exact tiles.", error);
        const opened = await openPngRasterSource(file, {
          onProgress: (progress, label) => {
            fileHint.textContent = `${file.name}: ${label || `${progress}%`}`;
          }
        });
        return pngTiledImageRecord(file, opened);
      }
      const provisionalSource = createBitmapRasterSource(thumbnail, {
        width: header.width,
        height: header.height,
        maxCachedTiles: 12
      });
      const provisionalPreview = provisionalSource.readPreview(1024);
      const rasterSource = createSwitchableRasterSource(provisionalSource, header.width, header.height);
      const record = createImageRecord(
        file,
        header.width,
        header.height,
        pngTypeLabel(header),
        null,
        "raster",
        {
          format: "PNG loading",
          bitDepth: `${header.bitDepth}-bit`,
          rasterSource,
          range: computeRange(provisionalPreview.pixels),
          overview: provisionalPreview
        }
      );
      record.type = `${record.type} (provisional thumbnail)`;
      void openPngRasterSource(file, {
        onProgress: (progress, label) => {
          fileHint.textContent = `${file.name}: ${label || `${progress}%`}`;
        }
      }).then((opened) => {
        if (!rasterSource.swap(opened.rasterSource)) return;
        record.format = "PNG";
        record.type = pngTypeLabel(opened);
        const note = pngTransferNote(opened);
        if (note) record.type = `${record.type} ${note}`;
        record.range = computeRange(opened.preview.pixels);
        record.displayDirty = true;
        record.displayTileCache?.clear();
        selectionDetailsCache.delete(record);
        updateImageWindowSize(record);
        if (currentImage() === record) {
          updateSettingsPanel();
          updatePickerPanel();
          updateSelectionPanel();
        }
        fileHint.textContent = `${file.name}: full-resolution tiles ready`;
        requestRender();
      }).catch((error) => {
        console.error("PNG exact tile decode failed; provisional image retained.", error);
        record.format = "PNG preview";
        record.type = `${pngTypeLabel(header)} (provisional 8-bit thumbnail; exact tiles failed)`;
        updateImageWindowSize(record);
        fileHint.textContent = `${file.name}: exact tiles failed; showing provisional image`;
      });
      return record;
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    return null;
  }

  let decoded;
  try {
    decoded = await decodePng(bytes, { maxPixels: maxLoadedPngPixels });
  } catch (error) {
    if (error?.code === "PNG_CRC" || error?.code === "PNG_HUGE_UNSUPPORTED") {
      throw error;
    }
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

  const pixels = decoded.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = toLinear[Math.round(pixels[i] * sampleMax)];
    pixels[i + 1] = toLinear[Math.round(pixels[i + 1] * sampleMax)];
    pixels[i + 2] = toLinear[Math.round(pixels[i + 2] * sampleMax)];
  }

  let record;
  const canUseFullBitmapTiles = decoded.downsample > 1 && decoded.sourceWidth * decoded.sourceHeight <= 100_000_000;
  if (canUseFullBitmapTiles) {
    try {
      const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none" }).catch(() => createImageBitmap(file));
      const rasterSource = createBitmapRasterSource(bitmap);
      record = createImageRecord(file, decoded.sourceWidth, decoded.sourceHeight, pngTypeLabel(decoded), null, "raster", {
        rasterSource,
        range: computeRange(pixels)
      });
      record.type = `${record.type} (full-resolution Canvas tiles; measured values 8-bit)`;
    } catch (error) {
      console.warn("Full-resolution PNG bitmap failed; using decoded preview.", error);
      record = createImageRecord(file, decoded.width, decoded.height, pngTypeLabel(decoded), pixels, "raster");
      record.type = `${record.type}/preview`;
      record.sourceWidth = decoded.sourceWidth;
      record.sourceHeight = decoded.sourceHeight;
      record.downsample = decoded.downsample;
    }
  } else if (decoded.downsample > 1) {
    record = createImageRecord(file, decoded.width, decoded.height, pngTypeLabel(decoded), pixels, "raster");
    record.type = `${record.type}/preview (full-resolution bitmap exceeds browser memory limit)`;
    record.sourceWidth = decoded.sourceWidth;
    record.sourceHeight = decoded.sourceHeight;
    record.downsample = decoded.downsample;
  } else {
    record = createImageRecord(file, decoded.width, decoded.height, pngTypeLabel(decoded), pixels, "raster");
  }
  record.format = "PNG";
  record.bitDepth = `${decoded.bitDepth}-bit`;
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
  const metadata = await rasterFileMetadata(file);
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none" }).catch(() => createImageBitmap(file));
  const rasterSource = createBitmapRasterSource(bitmap);
  const preview = rasterSource.readPreview(1024);
  const record = createImageRecord(file, bitmap.width, bitmap.height, "raster/srgb", null, "raster", {
    ...metadata,
    rasterSource,
    range: computeRange(preview.pixels)
  });
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
  const metadata = kind === "exr"
    ? { format: "EXR", bitDepth: exrBitDepth(buffer) }
    : { format: "HDR", bitDepth: "RGBE8" };
  return createImageRecord(file, width, height, kind === "exr" ? "openexr/linear" : "radiance-hdr/linear", pixels, kind, metadata);
}

function pngHeaderMetadata(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorType = bytes[25];
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colorType,
    interlace: bytes[28],
    hasAlpha: colorType === 4 || colorType === 6,
    gamma: null,
    srgbIntent: null,
    hasIccProfile: false
  };
}

async function createPngThumbnail(file, width, height) {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const resizeWidth = Math.max(1, Math.round(width * scale));
  const resizeHeight = Math.max(1, Math.round(height * scale));
  const resize = { resizeWidth, resizeHeight, resizeQuality: "medium" };
  return createImageBitmap(file, { ...resize, colorSpaceConversion: "none" })
    .catch(() => createImageBitmap(file, resize));
}

function pngTiledImageRecord(file, opened) {
  const record = createImageRecord(
    file,
    opened.width,
    opened.height,
    pngTypeLabel(opened),
    null,
    "raster",
    {
      format: "PNG",
      bitDepth: `${opened.bitDepth}-bit`,
      rasterSource: opened.rasterSource,
      range: computeRange(opened.preview.pixels),
      overview: rasterOverview(opened.preview)
    }
  );
  const note = pngTransferNote(opened);
  if (note) record.type = `${record.type} ${note}`;
  return record;
}

function rasterOverview(preview, maximumEdge = 1024) {
  if (!preview?.pixels || preview.width < 1 || preview.height < 1) return null;
  const scale = Math.min(1, maximumEdge / Math.max(preview.width, preview.height));
  if (scale >= 1) return preview;
  const width = Math.max(1, Math.round(preview.width * scale));
  const height = Math.max(1, Math.round(preview.height * scale));
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(preview.height - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(preview.width - 1, Math.floor((x + 0.5) / scale));
      const sourceOffset = (sourceY * preview.width + sourceX) * 4;
      pixels.set(preview.pixels.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
}

async function rasterFileMetadata(file) {
  const format = rasterFormat(file);
  let bitDepth = ["JPEG", "WEBP", "GIF"].includes(format) ? "8-bit" : "";
  try {
    const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    if (format === "JPEG") {
      bitDepth = jpegBitDepth(bytes) || bitDepth;
    } else if (format === "BMP" && bytes.length >= 30) {
      bitDepth = `${new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(28, true)}-bit/pixel`;
    }
  } catch {
    // Format alone is still useful when source bit depth cannot be inspected.
  }
  return { format, bitDepth };
}

function rasterFormat(file) {
  const extension = file.name.split(".").pop()?.toUpperCase() || "IMAGE";
  if (extension === "JPG" || extension === "JPE") {
    return "JPEG";
  }
  if (extension === "TIF") {
    return "TIFF";
  }
  return extension;
}

function jpegBitDepth(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return "";
  }
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset++];
    if (sofMarkers.has(marker)) {
      return offset + 2 < bytes.length ? `${bytes[offset + 2]}-bit` : "";
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 1 >= bytes.length) {
      break;
    }
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2) {
      break;
    }
    offset += length;
  }
  return "";
}

function exrBitDepth(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 12 || view.getUint32(0, true) !== 20000630) {
    return "";
  }
  let offset = 8;
  while (offset < bytes.length) {
    const nameResult = readNullTerminated(bytes, offset, bytes.length);
    offset = nameResult.next;
    if (!nameResult.value) {
      break;
    }
    const typeResult = readNullTerminated(bytes, offset, bytes.length);
    offset = typeResult.next;
    if (offset + 4 > bytes.length) {
      break;
    }
    const size = view.getUint32(offset, true);
    offset += 4;
    const end = Math.min(bytes.length, offset + size);
    if (nameResult.value === "channels" && typeResult.value === "chlist") {
      const types = new Set();
      let channelOffset = offset;
      while (channelOffset < end) {
        const channelName = readNullTerminated(bytes, channelOffset, end);
        channelOffset = channelName.next;
        if (!channelName.value || channelOffset + 16 > end) {
          break;
        }
        types.add(view.getInt32(channelOffset, true));
        channelOffset += 16;
      }
      return [...types].map((type) => type === 1 ? "16F" : type === 2 ? "32F" : type === 0 ? "32U" : "?").join("/");
    }
    offset = end;
  }
  return "";
}

function readNullTerminated(bytes, offset, limit) {
  let end = offset;
  while (end < limit && bytes[end] !== 0) {
    end += 1;
  }
  return {
    value: new TextDecoder().decode(bytes.subarray(offset, end)),
    next: Math.min(limit, end + 1)
  };
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

function createImageRecord(file, width, height, type, pixels, sourceFormat = "raster", metadata = {}) {
  const id = nextId;
  nextId += 1;
  const rasterSource = metadata.rasterSource || createMemoryRasterSource(pixels, width, height);
  const range = metadata.range || computeRange(pixels);
  return {
    id,
    name: file.name,
    width,
    height,
    sourceWidth: metadata.sourceWidth || width,
    sourceHeight: metadata.sourceHeight || height,
    downsample: metadata.downsample || 1,
    type,
    sourceFormat,
    format: metadata.format || (sourceFormat === "glsl" ? "GLSL" : sourceFormat === "values" ? "VALUES" : rasterFormat(file)),
    bitDepth: metadata.bitDepth || (sourceFormat === "glsl" || sourceFormat === "values" ? "32F" : ""),
    hdr: Boolean(metadata.hdr),
    valueUnit: metadata.valueUnit || "relative",
    colorPrimaries: metadata.colorPrimaries || null,
    transfer: metadata.transfer || null,
    matrix: metadata.matrix || null,
    fullRange: metadata.fullRange ?? null,
    source: { kind: "external", name: file.name },
    pixels,
    rasterSource,
    range,
    overview: metadata.overview || null,
    settings: {
      autoLevel: false,
      logDisplay: metadata.logDisplay ?? metadata.hdr ?? (sourceFormat === "hdr" || sourceFormat === "exr"),
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
    displayDirty: true,
    mode: "original",
    original: null,
    glsl: null
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
  frame.classList.toggle("pq-display", image.transfer === "pq" && image.valueUnit === "nit");
  frame.dataset.id = String(image.id);

  const titlebar = document.createElement("div");
  titlebar.className = "window-titlebar";
  const title = document.createElement("div");
  title.className = "window-title";
  title.textContent = image.name;
  const size = document.createElement("div");
  size.className = "window-size";
  size.textContent = imageInfoLabel(image);
  size.title = size.textContent;
  const modeTabs = document.createElement("div");
  modeTabs.className = "window-mode-tabs";
  const originalButton = document.createElement("button");
  originalButton.className = "window-mode-tab";
  originalButton.type = "button";
  originalButton.textContent = "Original";
  originalButton.title = "Show the original image";
  const glslButton = document.createElement("button");
  glslButton.className = "window-mode-tab";
  glslButton.type = "button";
  glslButton.textContent = "GLSL";
  glslButton.title = "Show and edit the GLSL result";
  modeTabs.append(originalButton, glslButton);
  const closeButton = document.createElement("button");
  closeButton.className = "window-close";
  closeButton.type = "button";
  closeButton.ariaLabel = "Close image window";
  closeButton.textContent = "x";
  titlebar.append(title, size, modeTabs, closeButton);

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
    closeButton,
    size,
    modeTabs,
    originalButton,
    glslButton
  };

  frame.addEventListener("pointerdown", () => selectImage(image));

  titlebar.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".window-close, .window-mode-tabs")) {
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

  modeTabs.addEventListener("pointerdown", (event) => event.stopPropagation());
  originalButton.addEventListener("click", (event) => {
    event.stopPropagation();
    selectImage(image);
    switchImageMode(image, "original");
  });
  glslButton.addEventListener("click", (event) => {
    event.stopPropagation();
    selectImage(image);
    openGlslEditor(image);
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
    const hitPicker = event.button === 0 ? pickerAtEvent(image, event) : null;
    if (hitPicker) {
      const startPixel = pixelFromEvent(image, event, true);
      event.preventDefault();
      selectedPickerId = hitPicker.id;
      hoveredPickerId = hitPicker.id;
      activeDrag = {
        kind: "movePicker",
        image,
        picker: hitPicker,
        startX: event.clientX,
        startY: event.clientY,
        startPixel,
        x: hitPicker.x,
        y: hitPicker.y,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("picker-moving");
      updatePickerPanel();
      requestRender();
      return;
    }
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
      requestSelectionGraphDraw();
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
    if (!image.pan && activeDrag?.kind !== "movePicker") {
      const hoveredPicker = pickerAtEvent(image, event);
      const nextHoveredPickerId = hoveredPicker?.id ?? null;
      canvas.classList.toggle("picker-hover", Boolean(hoveredPicker));
      if (nextHoveredPickerId !== hoveredPickerId) {
        hoveredPickerId = nextHoveredPickerId;
        requestHoveredPickerUi({ scroll: true });
        requestRender();
      }
    }
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
    canvas.classList.remove("picker-hover");
    if (hoveredPickerId !== null) {
      hoveredPickerId = null;
      requestHoveredPickerUi();
      requestRender();
    }
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

  updateImageModeTabs(image);
  applyWindowGeometry(image);
}

function selectImage(image, forceRefresh = false) {
  const selectionChanged = selectedId !== image.id;
  selectedId = image.id;
  if (image.window.z !== topZ) {
    image.window.z = ++topZ;
    image.elements?.frame.style.setProperty("z-index", String(image.window.z));
  }
  if (!selectionChanged && !forceRefresh) {
    return;
  }
  for (const item of images) {
    item.elements?.frame.classList.toggle("active", item.id === image.id);
  }
  updateSettingsPanel();
  ensureFloatingPanelAccessible(inspector);
  updateSelectionPanel();
  requestSelectionGraphDraw();
  updateViewState();
  syncGlslEditorForSelection();
  syncGlslShareUrl(image);
  scheduleSessionSave();
}

function clearActiveSelection() {
  selectedId = null;
  syncGlslEditorForSelection();
  syncGlslShareUrl(null);
  for (const image of images) {
    image.elements?.frame.classList.remove("active");
  }
  updateSettingsPanel();
  updateSelectionPanel();
  requestSelectionGraphDraw();
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
    requestSelectionGraphDraw();
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

function ensureFloatingPanelAccessible(panel) {
  if (panel.classList.contains("hidden")) {
    return;
  }
  const viewportRect = viewport.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.width <= 0 || panelRect.height <= 0) {
    return;
  }

  const currentX = panelRect.left - viewportRect.left;
  const currentY = panelRect.top - viewportRect.top;
  const next = clampPanelPosition(panel, currentX, currentY);
  if (Math.abs(next.x - currentX) > 0.5 || Math.abs(next.y - currentY) > 0.5) {
    panel.style.left = `${next.x}px`;
    panel.style.top = `${next.y}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  const panelZ = Number.parseInt(getComputedStyle(panel).zIndex, 10);
  if (!Number.isFinite(panelZ) || panelZ <= topZ) {
    panel.style.zIndex = String(++topUiZ);
  }
}

function closeImage(image) {
  const index = images.findIndex((item) => item.id === image.id);
  if (index === -1) {
    return;
  }
  if (image.pickers.some((picker) => picker.id === selectedPickerId)) {
    selectedPickerId = null;
  }
  if (image.pickers.some((picker) => picker.id === hoveredPickerId)) {
    hoveredPickerId = null;
  }
  image.elements?.frame.remove();
  const rasterSources = new Set([
    image.rasterSource,
    image.original?.rasterSource,
    image.glsl?.rasterSource
  ]);
  rasterSources.forEach((source) => source?.dispose?.());
  image.displayTileCache?.clear();
  images.splice(index, 1);
  if (glslTargetId === image.id) {
    closeGlslEditor();
  }
  if (selectedId === image.id) {
    clearActiveSelection();
  }
  dropPrompt.classList.toggle("hidden", images.length > 0);
  fileHint.textContent = images.length ? `${images.length} image${images.length === 1 ? "" : "s"} opened` : "Drop images on the black view";
  updatePickerCursor();
  updatePickerPanel();
  updateSelectionPanel();
  requestSelectionGraphDraw();
  syncGlslEditorForSelection();
  requestRender();
  scheduleSessionSave();
}

// ---- GLSL エディタ ----
//
// 画像ウィンドウは Original / GLSL の表示データを内部に持ち、既存機能が読む
// pixels / width / height だけをタブ切替時に差し替える。New Image は GLSL のみ。
// エディタは選択中かつ GLSL 表示中のウィンドウにだけ自動で束縛する。

const glslRunDelay = 300;
let glslTargetId = null;
let glslRunTimer = null;
let glslGeneratedCount = 0;

function glslTargetImage() {
  return images.find((image) => image.id === glslTargetId) || null;
}

function imageVariant(image) {
  return {
    width: image.width,
    height: image.height,
    sourceWidth: image.sourceWidth,
    sourceHeight: image.sourceHeight,
    downsample: image.downsample,
    type: image.type,
    sourceFormat: image.sourceFormat,
    format: image.format,
    bitDepth: image.bitDepth,
    hdr: image.hdr,
    valueUnit: image.valueUnit,
    colorPrimaries: image.colorPrimaries,
    transfer: image.transfer,
    matrix: image.matrix,
    fullRange: image.fullRange,
    name: image.name,
    pixels: image.pixels,
    rasterSource: image.rasterSource,
    range: image.range
  };
}

function glslVariant(code, pixels, width, height) {
  return {
    code,
    renderedCode: code,
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    downsample: 1,
    type: "glsl/linear",
    sourceFormat: "glsl",
    format: "GLSL",
    bitDepth: "32F",
    hdr: false,
    valueUnit: "relative",
    colorPrimaries: "bt709",
    transfer: "linear",
    matrix: "rgb",
    fullRange: true,
    pixels,
    rasterSource: createMemoryRasterSource(pixels, width, height),
    range: computeRange(pixels)
  };
}

function glslInputPayload(image) {
  const input = image?.original;
  if (!input) {
    return null;
  }
  const dimensions = fitLongEdge(input.width, input.height, 4096);
  if (input.pixels && dimensions.width === input.width && dimensions.height === input.height) {
    return { pixels: input.pixels, width: input.width, height: input.height, key: `${image.id}:original` };
  }
  const cached = image.glslInputPreview;
  if (
    cached?.sourceIdentity === input.rasterSource
    && cached.width === dimensions.width
    && cached.height === dimensions.height
  ) {
    return cached.payload;
  }
  let pixels;
  if (input.pixels) {
    pixels = resampleLinearPixels(input.pixels, input.width, input.height, dimensions.width, dimensions.height);
  } else if (typeof input.rasterSource?.readPreview === "function") {
    const preview = input.rasterSource.readPreview(4096);
    pixels = preview.width === dimensions.width && preview.height === dimensions.height
      ? preview.pixels
      : resampleLinearPixels(preview.pixels, preview.width, preview.height, dimensions.width, dimensions.height);
  } else {
    const materialized = input.rasterSource?.materialize?.();
    if (!(materialized instanceof Float32Array)) {
      throw new Error("This image source cannot provide GLSL input pixels.");
    }
    pixels = resampleLinearPixels(materialized, input.width, input.height, dimensions.width, dimensions.height);
  }
  const payload = {
    pixels,
    width: dimensions.width,
    height: dimensions.height,
    key: `${image.id}:original-preview-${dimensions.width}x${dimensions.height}`
  };
  image.glslInputPreview = { sourceIdentity: input.rasterSource, width: dimensions.width, height: dimensions.height, payload };
  return payload;
}

function fitLongEdge(width, height, maximumEdge) {
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function resampleLinearPixels(source, sourceWidth, sourceHeight, width, height) {
  const output = new Float32Array(width * height * 4);
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  for (let y = 0; y < height; y += 1) {
    const sourceY = clamp((y + 0.5) * scaleY - 0.5, 0, sourceHeight - 1);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = clamp((x + 0.5) * scaleX - 0.5, 0, sourceWidth - 1);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const fx = sourceX - x0;
      const topLeft = (y0 * sourceWidth + x0) * 4;
      const topRight = (y0 * sourceWidth + x1) * 4;
      const bottomLeft = (y1 * sourceWidth + x0) * 4;
      const bottomRight = (y1 * sourceWidth + x1) * 4;
      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = source[topLeft + channel] + (source[topRight + channel] - source[topLeft + channel]) * fx;
        const bottom = source[bottomLeft + channel] + (source[bottomRight + channel] - source[bottomLeft + channel]) * fx;
        output[target + channel] = top + (bottom - top) * fy;
      }
    }
  }
  return output;
}

function applyImageVariant(image, mode) {
  const variant = mode === "glsl" ? image.glsl : image.original;
  if (!variant) {
    return false;
  }
  const sizeChanged = image.width !== variant.width || image.height !== variant.height;
  image.mode = mode;
  image.width = variant.width;
  image.height = variant.height;
  image.sourceWidth = variant.sourceWidth;
  image.sourceHeight = variant.sourceHeight;
  image.downsample = variant.downsample;
  image.type = variant.type;
  image.sourceFormat = variant.sourceFormat;
  image.format = variant.format;
  image.bitDepth = variant.bitDepth;
  image.hdr = Boolean(variant.hdr);
  image.valueUnit = variant.valueUnit || "relative";
  image.colorPrimaries = variant.colorPrimaries || null;
  image.transfer = variant.transfer || null;
  image.matrix = variant.matrix || null;
  image.fullRange = variant.fullRange ?? null;
  image.pixels = variant.pixels;
  image.rasterSource = variant.rasterSource;
  image.range = variant.range;
  image.displayCanvas = null;
  image.displayDirty = true;

  if (sizeChanged) {
    image.pickers = image.pickers.filter((picker) => picker.x < image.width && picker.y < image.height);
    image.selection = image.selection ? clampSavedRect(image.selection, image.width, image.height) : null;
    if (image.view.fit) {
      fitImageToWindow(image, false);
    }
  }
  selectionDetailsCache.delete(image);
  cancelSelectionDetailsWork();
  cancelSelectionMatrixCopy();
  updateImageModeTabs(image);
  updateImageWindowSize(image);
  updateSettingsPanel();
  updatePickerPanel();
  updateSelectionPanel();
  requestSelectionGraphDraw();
  requestRender();
  scheduleSessionSave();
  return true;
}

function switchImageMode(image, mode) {
  if (image.mode !== mode) {
    if (!applyImageVariant(image, mode)) {
      return;
    }
  }
  syncGlslEditorForSelection(mode === "glsl");
  syncGlslShareUrl(image);
}

function updateImageModeTabs(image) {
  const elements = image.elements;
  if (!elements) {
    return;
  }
  const generatedOnly = Boolean(image.glsl && !image.original);
  elements.originalButton.hidden = generatedOnly;
  elements.originalButton.classList.toggle("active", image.mode === "original");
  elements.glslButton.classList.toggle("active", image.mode === "glsl");
}

function updateImageWindowSize(image) {
  if (image.elements?.size) {
    const label = imageInfoLabel(image);
    image.elements.size.textContent = label;
    image.elements.size.title = label;
    image.elements.frame.classList.toggle("pq-display", image.transfer === "pq" && image.valueUnit === "nit");
    return;
  }
  const sizeLabel = image.elements?.frame.querySelector(".window-size");
  if (sizeLabel) {
    sizeLabel.textContent = imageInfoLabel(image);
  }
}

function imageInfoLabel(image) {
  const preview = image.downsample > 1 ? `↓${image.downsample}` : "";
  const width = image.sourceWidth || image.width;
  const height = image.sourceHeight || image.height;
  const pqDisplay = image.transfer === "pq" && image.valueUnit === "nit"
    ? "PQ → Linear [nit] · SDR tone-mapped"
    : "";
  return [`${width}x${height}`, image.format, image.bitDepth, pqDisplay, preview].filter(Boolean).join(" · ");
}

function openGlslEditor(sourceImage) {
  const support = getGlslSupport();
  if (!support.ok) {
    fileHint.textContent = `GLSL unavailable: ${support.reason}`;
    return;
  }

  if (sourceImage?.glsl) {
    switchImageMode(sourceImage, "glsl");
    return;
  }

  const code = sourceImage ? DEFAULT_FILTER_CODE : DEFAULT_GENERATOR_CODE;
  let width = 1024;
  let height = 1024;

  // 元画像は参照だけを保持するため、タブを増やしても画素配列は複製しない。
  if (sourceImage) {
    sourceImage.original = imageVariant(sourceImage);
    const preview = glslInputPayload(sourceImage);
    width = preview.width;
    height = preview.height;
  }

  let pixels;
  try {
    pixels = runGlslShader({ code, input: glslInputPayload(sourceImage), width, height });
  } catch (error) {
    if (sourceImage) {
      sourceImage.original = null;
    }
    fileHint.textContent = `GLSL failed: ${error.message}`;
    return;
  }

  if (sourceImage) {
    sourceImage.glsl = glslVariant(code, pixels, width, height);
    applyImageVariant(sourceImage, "glsl");
    bindGlslEditor(sourceImage, true);
    return;
  }

  addGeneratedGlslImage({ code, renderedCode: code, pixels, width, height, focusEditor: true });
}

function addGeneratedGlslImage({ code, renderedCode, pixels, width, height, focusEditor, errorMessage = "" }) {
  glslGeneratedCount += 1;
  const image = createImageRecord({ name: `glsl${glslGeneratedCount}` }, width, height, "glsl/linear", pixels, "glsl");
  image.source = { kind: "glsl-generated" };
  image.mode = "glsl";
  image.glsl = glslVariant(code, pixels, width, height);
  image.glsl.renderedCode = renderedCode;
  if (errorMessage) {
    image.glsl.statusKind = "error";
    image.glsl.status = errorMessage;
  }

  images.push(image);
  createImageWindow(image, null, 0);
  selectImage(image);
  fitImageToWindow(image, false);
  dropPrompt.classList.add("hidden");
  fileHint.textContent = `${images.length} image${images.length === 1 ? "" : "s"} opened`;
  requestRender();
  scheduleSessionSave();
  if (focusEditor) {
    glslCodeInput.focus();
  }
  return image;
}

function initializeApp() {
  if (openGlslShareFromLocation()) {
    return;
  }
  void restoreSavedSession();
}

function openGlslShareFromLocation() {
  let shared;
  try {
    shared = decodeGlslShareHash(window.location.hash);
  } catch (error) {
    fileHint.textContent = error.message;
    return true;
  }
  if (shared) {
    openSharedGlslImage(shared);
    return true;
  }
  return false;
}

function openSharedGlslImage({ code, width, height }) {
  const support = getGlslSupport();
  if (!support.ok) {
    fileHint.textContent = `Shared GLSL unavailable: ${support.reason}`;
    return;
  }

  let pixels;
  let renderedCode = code;
  let errorMessage = "";
  try {
    pixels = runGlslShader({ code, input: null, width, height });
  } catch (error) {
    errorMessage = error?.log || error?.message || String(error);
    renderedCode = DEFAULT_GENERATOR_CODE;
    try {
      pixels = runGlslShader({ code: renderedCode, input: null, width, height });
    } catch (fallbackError) {
      fileHint.textContent = `Shared GLSL failed: ${fallbackError.message}`;
      return;
    }
  }

  addGeneratedGlslImage({ code, renderedCode, pixels, width, height, focusEditor: false, errorMessage });
  fileHint.textContent = errorMessage ? "Opened shared GLSL with a compile error" : "Opened shared GLSL image";
}

function isShareableGlslImage(image) {
  return Boolean(image?.glsl && !image.original && image.source?.kind === "glsl-generated");
}

function replaceUrlHash(hash) {
  if (window.location.hash === hash) {
    return true;
  }
  try {
    const url = new URL(window.location.href);
    url.hash = hash;
    window.history.replaceState(window.history.state, "", url);
    return true;
  } catch (error) {
    console.warn("GLSL share URL update skipped.", error);
    return false;
  }
}

function syncGlslShareUrl(image = currentImage()) {
  if (!isShareableGlslImage(image) || image.id !== selectedId) {
    replaceUrlHash("");
    return;
  }

  const editorBound = glslTargetId === image.id;
  const width = editorBound ? glslSizeValue(glslWidthInput, image.glsl.width) : image.glsl.width;
  const height = editorBound ? glslSizeValue(glslHeightInput, image.glsl.height) : image.glsl.height;
  try {
    replaceUrlHash(encodeGlslShareHash({ width, height, code: image.glsl.code }));
  } catch (error) {
    replaceUrlHash("");
    fileHint.textContent = `GLSL share URL unavailable: ${error.message}`;
  }
}

function bindGlslEditor(image, focusEditor = false) {
  cancelGlslRun();
  glslTargetId = image.id;
  glslTitleText.textContent = `GLSL - ${image.name}`;
  glslCodeInput.value = image.glsl.code;
  glslWidthInput.value = String(image.glsl.width);
  glslHeightInput.value = String(image.glsl.height);
  glslPresetSelect.value = "";
  updateGlslInputLabel(image);
  glslPanel.classList.remove("hidden");
  glslPanel.style.zIndex = String(++topUiZ);
  ensureFloatingPanelAccessible(glslPanel);
  setGlslStatus(image.glsl.statusKind || "ok", image.glsl.status || "Ready.");
  if (focusEditor) {
    glslCodeInput.focus();
  }
}

function closeGlslEditor() {
  cancelGlslRun();
  glslTargetId = null;
  glslPanel.classList.add("hidden");
}

function updateGlslInputLabel(image) {
  const input = image.original;
  if (input) {
    const preview = glslInputPayload(image);
    const label = preview.width === input.width && preview.height === input.height
      ? `${preview.width}x${preview.height}`
      : `${preview.width}x${preview.height} preview`;
    glslInputLabel.textContent = `${input.name} (${label})`;
    glslMatchInputButton.disabled = false;
    return;
  }
  glslMatchInputButton.disabled = true;
  glslInputLabel.textContent = "none (generate)";
}

function syncGlslEditorForSelection(focusEditor = false) {
  const image = currentImage();
  const shouldShow = Boolean(image && image.mode === "glsl" && image.glsl);
  if (!shouldShow) {
    closeGlslEditor();
    return;
  }
  if (glslTargetId !== image.id || glslPanel.classList.contains("hidden")) {
    bindGlslEditor(image, focusEditor);
  } else if (focusEditor) {
    glslCodeInput.focus();
  }
}

function setGlslStatus(kind, message) {
  glslStatus.textContent = message;
  glslStatus.classList.toggle("error", kind === "error");
  glslStatus.classList.toggle("pending", kind === "pending");
}

function cancelGlslRun() {
  if (glslRunTimer !== null) {
    clearTimeout(glslRunTimer);
    glslRunTimer = null;
  }
}

function scheduleGlslRun() {
  const target = glslTargetImage();
  if (!target || target.mode !== "glsl") {
    return;
  }
  cancelGlslRun();
  setGlslStatus("pending", "Compiling...");
  glslRunTimer = setTimeout(() => {
    glslRunTimer = null;
    runGlslNow();
  }, glslRunDelay);
}

function glslSizeValue(input, fallback) {
  const value = Math.floor(Number(input.value));
  return Number.isFinite(value) && value >= 1 ? Math.min(4096, value) : Math.min(4096, fallback);
}

function runGlslNow() {
  const target = glslTargetImage();
  if (!target) {
    closeGlslEditor();
    return;
  }

  const code = glslCodeInput.value;
  const width = glslSizeValue(glslWidthInput, target.glsl.width);
  const height = glslSizeValue(glslHeightInput, target.glsl.height);

  // シェーダ実行だけでなく反映処理まで含めて捕まえる。ここで抜けると
  // ステータスが "Compiling..." のまま戻らなくなるため、必ずどちらかの結果を出す。
  try {
    const shaderStarted = performance.now();
    const pixels = runGlslShader({ code, input: glslInputPayload(target), width, height });
    const shaderMs = performance.now() - shaderStarted;

    const applyStarted = performance.now();
    applyGlslResult(target, pixels, width, height, code);
    const applyMs = performance.now() - applyStarted;

    setGlslStatus(
      "ok",
      `Updated ${width} x ${height} - shader ${Math.round(shaderMs)} ms, display ${Math.round(applyMs)} ms`
    );
  } catch (error) {
    // 失敗しても直前に成功した出力を残す（編集中に画像が壊れないようにする）
    console.error("GLSL run failed.", error);
    const message = error?.log || error?.message || String(error);
    target.glsl.statusKind = "error";
    target.glsl.status = message;
    setGlslStatus("error", message);
    scheduleSessionSave();
  }
}

function applyGlslResult(image, pixels, width, height, code) {
  const sizeChanged = image.width !== width || image.height !== height;
  const rasterSource = createMemoryRasterSource(pixels, width, height);
  image.glsl?.rasterSource?.dispose?.();
  image.width = width;
  image.height = height;
  image.pixels = pixels;
  image.rasterSource = rasterSource;
  image.range = computeRange(pixels);
  image.type = "glsl/linear";
  image.sourceFormat = "glsl";
  image.format = "GLSL";
  image.bitDepth = "32F";
  image.sourceWidth = width;
  image.sourceHeight = height;
  image.downsample = 1;
  image.glsl = {
    ...image.glsl,
    code,
    renderedCode: code,
    pixels,
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    downsample: 1,
    type: image.type,
    sourceFormat: image.sourceFormat,
    format: image.format,
    bitDepth: image.bitDepth,
    rasterSource,
    range: image.range,
    statusKind: "ok",
    status: "Ready."
  };
  image.displayCanvas = null;
  image.displayDirty = true;

  if (sizeChanged) {
    image.pickers = image.pickers.filter((picker) => picker.x < width && picker.y < height);
    image.selection = image.selection ? clampSavedRect(image.selection, width, height) : null;
    updateImageWindowSize(image);
    if (image.view.fit) {
      fitImageToWindow(image, false);
    }
  }

  updateSettingsPanel();
  selectionDetailsCache.delete(image);
  cancelSelectionDetailsWork();
  cancelSelectionMatrixCopy();
  updatePickerPanel();
  updateSelectionPanel();
  requestSelectionGraphDraw();
  requestRender();
  syncGlslShareUrl(image);
  scheduleSessionSave();
}

function initGlslEditor() {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Custom";
  placeholder.hidden = true;
  glslPresetSelect.append(placeholder);
  for (const [index, preset] of GLSL_PRESETS.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = preset.name;
    glslPresetSelect.append(option);
  }
  makeFloatingPanelDraggable(glslPanel);

  glslResize.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || glslPanel.classList.contains("collapsed")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const panelRect = glslPanel.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    glslPanel.style.left = `${panelRect.left - viewportRect.left}px`;
    glslPanel.style.top = `${panelRect.top - viewportRect.top}px`;
    glslPanel.style.right = "auto";
    glslPanel.style.bottom = "auto";
    glslPanel.style.zIndex = String(++topUiZ);
    activeDrag = {
      kind: "glslResize",
      startX: event.clientX,
      startY: event.clientY,
      top: panelRect.top,
      height: panelRect.height
    };
    glslResize.setPointerCapture(event.pointerId);
  });

  glslCloseButton.addEventListener("click", closeGlslEditor);
  newImageButton.addEventListener("click", () => openGlslEditor(null));

  glslCodeInput.addEventListener("input", () => {
    const target = glslTargetImage();
    if (target?.glsl) {
      target.glsl.code = glslCodeInput.value;
    }
    glslPresetSelect.value = "";
    syncGlslShareUrl(target);
    scheduleGlslRun();
    scheduleSessionSave();
  });
  glslWidthInput.addEventListener("input", () => {
    syncGlslShareUrl(glslTargetImage());
    scheduleGlslRun();
  });
  glslHeightInput.addEventListener("input", () => {
    syncGlslShareUrl(glslTargetImage());
    scheduleGlslRun();
  });

  glslPresetSelect.addEventListener("change", () => {
    // "Custom" の value は空文字。Number("") は 0 になってしまうので数値として扱わない。
    const selected = glslPresetSelect.value;
    const preset = selected === "" ? null : GLSL_PRESETS[Number(selected)];
    if (!preset) {
      return;
    }
    glslCodeInput.value = preset.code;
    const target = glslTargetImage();
    if (target?.glsl) {
      target.glsl.code = preset.code;
    }
    syncGlslShareUrl(target);
    scheduleGlslRun();
  });

  glslMatchInputButton.addEventListener("click", () => {
    const target = glslTargetImage();
    const input = target?.original;
    if (!input) {
      return;
    }
    const preview = glslInputPayload(target);
    glslWidthInput.value = String(preview.width);
    glslHeightInput.value = String(preview.height);
    scheduleGlslRun();
  });

  // textarea の Tab はフォーカス移動ではなくインデントとして扱う
  glslCodeInput.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    glslCodeInput.setRangeText("  ", glslCodeInput.selectionStart, glslCodeInput.selectionEnd, "end");
    const target = glslTargetImage();
    if (target?.glsl) {
      target.glsl.code = glslCodeInput.value;
    }
    glslPresetSelect.value = "";
    syncGlslShareUrl(target);
    scheduleGlslRun();
    scheduleSessionSave();
  });
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
    if (image.pickers[existingIndex].id === selectedPickerId) selectedPickerId = null;
    if (image.pickers[existingIndex].id === hoveredPickerId) hoveredPickerId = null;
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

  const picker = {
    id: nextAvailablePickerId(),
    x: pixel.x,
    y: pixel.y,
    color: nextPickerColor()
  };
  image.pickers.push(picker);
  selectedPickerId = picker.id;
  hoveredPickerId = picker.id;
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
      if (image.pickers[index].id === selectedPickerId) selectedPickerId = null;
      if (image.pickers[index].id === hoveredPickerId) hoveredPickerId = null;
      image.pickers.splice(index, 1);
      updatePickerPanel();
      requestRender();
      scheduleSessionSave();
      return;
    }
  }
}

function drawPickers(image, ctx) {
  if (activePanelTab !== "pickers") return;
  const { width, height } = canvasCssSize(image);
  for (const picker of image.pickers) {
    const x = image.view.offsetX + (picker.x + 0.5) * image.view.scale;
    const y = image.view.offsetY + (picker.y + 0.5) * image.view.scale;
    if (x < -24 || y < -24 || x > width + 24 || y > height + 24) {
      continue;
    }

    const arm = 9;
    ctx.save();
    if (picker.id === hoveredPickerId) {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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

async function copySelection(image, rect, clipboardData = null) {
  if (rect.width * rect.height > maxInternalClipboardPixels) {
    internalClipboard = null;
    try {
      clipboardData?.setData("text/plain", "HDRI Viewer: selection is too large to copy safely.");
    } catch {
      // The UI message still explains why no value data was copied.
    }
    fileHint.textContent = `Copy is limited to ${maxInternalClipboardPixels.toLocaleString("en-US")} pixels.`;
    return;
  }
  const token = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  internalClipboard = {
    token,
    name: `${image.name} crop`,
    type: `${image.type}/crop`,
    sourceFormat: image.sourceFormat,
    format: image.format,
    bitDepth: image.bitDepth,
    width: rect.width,
    height: rect.height,
    pixels: await cropPixels(image, rect)
  };

  const portable = rect.width * rect.height <= portableClipboardMatrixPixels;
  const matrixText = portable
    ? serializeValueMatrix({
      ...internalClipboard,
      channels: [0, 1, 2, 3],
      encoding: "linear",
      alphaWeighted: false
    })
    : serializeInternalValueReference(internalClipboard);
  try {
    clipboardData?.setData("text/plain", matrixText);
  } catch {
    // Async Clipboard below may still succeed; the in-page value copy remains available either way.
  }

  if (isHdrImage(image)) {
    try {
      await navigator.clipboard?.writeText(matrixText);
    } catch {
      // The synchronous copy-event payload or internal reference remains usable.
    }
    fileHint.textContent = portable
      ? `Copied HDRI Value Matrix ${rect.width} x ${rect.height}`
      : `Copied HDR values internally ${rect.width} x ${rect.height} (use Copy Matrix for portable text)`;
    return;
  }

  const canvas = await makeRawCanvas(image, rect);
  try {
    await writeCanvasToClipboard(canvas, matrixText);
    fileHint.textContent = `Copied ${rect.width} x ${rect.height}`;
  } catch {
    fileHint.textContent = portable
      ? `Copied Value Matrix ${rect.width} x ${rect.height}`
      : `Copied internally ${rect.width} x ${rect.height}`;
  }
}

function isHdrImage(image) {
  // GLSL 出力は linear float なので HDR と同じ扱いにする
  return image.type.startsWith("openexr/") ||
    image.type.startsWith("radiance-hdr/") ||
    image.type.startsWith("glsl/") ||
    image.sourceFormat === "values";
}

async function cropPixels(image, rect) {
  return await image.rasterSource.copyRegion(rect);
}

function pickerAtEvent(image, event, radius = 14) {
  if (activePanelTab !== "pickers" || !image.pickers.length || !image.elements?.canvas) return null;
  const rect = image.elements.canvas.getBoundingClientRect();
  const viewX = event.clientX - rect.left;
  const viewY = event.clientY - rect.top;
  let closest = null;
  let closestDistance = radius * radius;
  for (let index = image.pickers.length - 1; index >= 0; index -= 1) {
    const picker = image.pickers[index];
    const x = image.view.offsetX + (picker.x + 0.5) * image.view.scale;
    const y = image.view.offsetY + (picker.y + 0.5) * image.view.scale;
    const distance = (viewX - x) ** 2 + (viewY - y) ** 2;
    if (distance <= closestDistance) {
      closest = picker;
      closestDistance = distance;
    }
  }
  return closest;
}

async function makeRawCanvas(image, rect = null) {
  const sourceRect = rect || { x: 0, y: 0, width: image.width, height: image.height };
  const canvas = document.createElement("canvas");
  canvas.width = sourceRect.width;
  canvas.height = sourceRect.height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(sourceRect.width, sourceRect.height);
  const pixels = await image.rasterSource.copyRegion(sourceRect);

  for (let y = 0; y < sourceRect.height; y += 1) {
    for (let x = 0; x < sourceRect.width; x += 1) {
      const sourceIndex = (y * sourceRect.width + x) * 4;
      const targetIndex = (y * sourceRect.width + x) * 4;
      imageData.data[targetIndex] = linearToSrgbByte(pixels[sourceIndex]);
      imageData.data[targetIndex + 1] = linearToSrgbByte(pixels[sourceIndex + 1]);
      imageData.data[targetIndex + 2] = linearToSrgbByte(pixels[sourceIndex + 2]);
      imageData.data[targetIndex + 3] = Math.round(clamp01(pixels[sourceIndex + 3]) * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function writeCanvasToClipboard(canvas, matrixText) {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image write is not available.");
  }
  const blob = new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Failed to encode clipboard image.")), "image/png");
  });
  await navigator.clipboard.write([new ClipboardItem({
    "image/png": blob,
    "text/plain": new Blob([matrixText], { type: "text/plain" })
  })]);
}

function pasteClipboardPixels(copied, sourceLabel = "values") {
  if (!copied) {
    return;
  }
  if (
    !Number.isInteger(copied.width) ||
    !Number.isInteger(copied.height) ||
    copied.width < 1 ||
    copied.height < 1 ||
    !(copied.pixels instanceof Float32Array) ||
    copied.pixels.length !== copied.width * copied.height * 4
  ) {
    fileHint.textContent = "Paste failed: clipboard pixel data is invalid.";
    return;
  }
  const image = createImageRecord(
    { name: copied.name || "pasted values" },
    copied.width,
    copied.height,
    copied.type || "clipboard-values/linear",
    new Float32Array(copied.pixels),
    copied.sourceFormat || "values",
    { format: copied.format, bitDepth: copied.bitDepth }
  );
  image.source = { kind: "embedded" };
  images.push(image);
  createImageWindow(image, null, 0);
  selectImage(image);
  fitImageToWindow(image, false);
  dropPrompt.classList.add("hidden");
  fileHint.textContent = `Pasted ${sourceLabel} ${image.width} x ${image.height}`;
  requestRender();
  scheduleSessionSave();
}

async function saveImage(image, format) {
  if (!allowedSaveFormats(image).includes(format)) {
    fileHint.textContent = "Save format is locked to the source format.";
    return;
  }
  if (format === "hdr") {
    if (!confirmHdrSave(image)) {
      return;
    }
    const pixels = image.pixels || await materializeImagePixels(image);
    downloadBytes(encodeHdr(image, pixels), `${stripExtension(image.name)}.hdr`, "image/vnd.radiance");
    return;
  }
  if (format === "exr") {
    const pixels = image.pixels || await materializeImagePixels(image);
    downloadBytes(encodeExr(image, pixels), `${stripExtension(image.name)}.exr`, "image/aces");
    return;
  }

  const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  const extension = format === "jpeg" ? "jpg" : format;
  const canvas = await makeRawCanvas(image);
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

async function materializeImagePixels(image) {
  fileHint.textContent = `${image.name}: preparing full-resolution pixels...`;
  const pixels = await image.rasterSource?.materialize?.();
  if (!(pixels instanceof Float32Array) || pixels.length !== image.width * image.height * 4) {
    throw new Error("Full-resolution pixels are unavailable for this image.");
  }
  return pixels;
}

function encodeHdr(image, sourcePixels = image.pixels) {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${image.height} +X ${image.width}\n`;
  const headerBytes = new TextEncoder().encode(header);
  const encodedPixels = new Uint8Array(image.width * image.height * 4);

  for (let i = 0, j = 0; i < sourcePixels.length; i += 4, j += 4) {
    const rgbe = linearRgbToRgbe(sourcePixels[i], sourcePixels[i + 1], sourcePixels[i + 2]);
    encodedPixels[j] = rgbe[0];
    encodedPixels[j + 1] = rgbe[1];
    encodedPixels[j + 2] = rgbe[2];
    encodedPixels[j + 3] = rgbe[3];
  }

  const out = new Uint8Array(headerBytes.length + encodedPixels.length);
  out.set(headerBytes, 0);
  out.set(encodedPixels, headerBytes.length);
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

function encodeExr(image, pixels = image.pixels) {
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
        out.f32(pixels[sourceIndex]);
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
        selectImage(image, true);
      }
    } else {
      updateSettingsPanel();
      updateSelectionPanel();
      requestSelectionGraphDraw();
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
      graph: panelSessionState(selectionGraphPanel),
      glsl: panelSessionState(glslPanel)
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
    format: image.format,
    bitDepth: image.bitDepth,
    hdr: image.hdr,
    valueUnit: image.valueUnit,
    colorPrimaries: image.colorPrimaries,
    transfer: image.transfer,
    matrix: image.matrix,
    fullRange: image.fullRange,
    source: imageSourceSessionState(image),
    settings: { ...image.settings },
    view: { ...image.view },
    pickers: image.pickers.map((picker) => ({ ...picker })),
    selection: image.selection ? { ...image.selection } : null,
    window: { ...image.window },
    // 巨大な出力画素は保存せず、復元時に最後に成功したコードから再生成する。
    glsl: image.glsl ? {
      code: image.glsl.code,
      renderedCode: image.glsl.renderedCode || image.glsl.code,
      width: image.glsl.width,
      height: image.glsl.height,
      mode: image.mode,
      generator: !image.original
    } : null
  };
}

function imageSourceSessionState(image) {
  const source = image.source || { kind: "external" };
  if (source.kind === "glsl-generated") {
    return { kind: "glsl-generated" };
  }
  if (source.kind === "embedded") {
    const stored = image.original || image;
    return {
      kind: "embedded",
      width: stored.width,
      height: stored.height,
      type: stored.type,
      sourceFormat: stored.sourceFormat,
      format: stored.format,
      bitDepth: stored.bitDepth,
      hdr: stored.hdr,
      valueUnit: stored.valueUnit,
      colorPrimaries: stored.colorPrimaries,
      transfer: stored.transfer,
      matrix: stored.matrix,
      fullRange: stored.fullRange,
      pixels: stored.pixels.buffer.slice(stored.pixels.byteOffset, stored.pixels.byteOffset + stored.pixels.byteLength)
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
  applyPanelSessionState(glslPanel, session.panels?.glsl);
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
  if (source.kind === "glsl-generated" && savedImage.glsl && typeof savedImage.glsl.code === "string") {
    const width = Math.max(1, Math.floor(Number(savedImage.glsl.width) || 1024));
    const height = Math.max(1, Math.floor(Number(savedImage.glsl.height) || 1024));
    const renderedCode = savedImage.glsl.renderedCode || savedImage.glsl.code;
    const pixels = runGlslShader({ code: renderedCode, input: null, width, height });
    const image = createImageRecord(
      { name: savedImage.name || "glsl image" },
      width,
      height,
      "glsl/linear",
      pixels,
      "glsl"
    );
    image.source = { kind: "glsl-generated" };
    return image;
  }
  if (source.kind === "embedded" && source.pixels instanceof ArrayBuffer) {
    const pixels = new Float32Array(source.pixels);
    const width = Math.max(1, Math.floor(Number(source.width) || savedImage.width));
    const height = Math.max(1, Math.floor(Number(source.height) || savedImage.height));
    if (pixels.length !== width * height * 4) {
      return null;
    }
    const image = createImageRecord(
      { name: savedImage.name || "pasted image" },
      width,
      height,
      source.type || savedImage.type || "raster/srgb",
      pixels,
      source.sourceFormat || savedImage.sourceFormat || "raster",
      {
        format: source.format || savedImage.format,
        bitDepth: source.bitDepth || savedImage.bitDepth,
        hdr: source.hdr ?? savedImage.hdr,
        valueUnit: source.valueUnit || savedImage.valueUnit,
        colorPrimaries: source.colorPrimaries || savedImage.colorPrimaries,
        transfer: source.transfer || savedImage.transfer,
        matrix: source.matrix || savedImage.matrix,
        fullRange: source.fullRange ?? savedImage.fullRange
      }
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
  const generatedNameMatch = /^glsl(\d+)$/.exec(image.name);
  if (generatedNameMatch) {
    glslGeneratedCount = Math.max(glslGeneratedCount, Number(generatedNameMatch[1]));
  }
  image.settings = {
    ...image.settings,
    ...(savedImage.settings || {})
  };
  image.view = {
    ...image.view,
    ...(savedImage.view || {})
  };
  const savedPickers = Array.isArray(savedImage.pickers)
    ? savedImage.pickers.filter((picker) => Number.isInteger(picker.x) && Number.isInteger(picker.y)).map((picker) => ({ ...picker }))
    : [];
  const savedSelection = savedImage.selection ? { ...savedImage.selection } : null;
  if (savedImage.glsl && typeof savedImage.glsl.code === "string") {
    const generator = typeof savedImage.glsl.generator === "boolean"
      ? savedImage.glsl.generator
      : savedImage.source?.kind === "embedded" && savedImage.sourceFormat === "glsl";
    const width = Math.max(1, Math.floor(Number(savedImage.glsl.width) || image.width));
    const height = Math.max(1, Math.floor(Number(savedImage.glsl.height) || image.height));
    const renderedCode = savedImage.glsl.renderedCode || savedImage.glsl.code;
    try {
      if (generator) {
        image.original = null;
        image.glsl = glslVariant(renderedCode, image.pixels, image.width, image.height);
      } else {
        image.original = imageVariant(image);
        const pixels = runGlslShader({ code: renderedCode, input: glslInputPayload(image), width, height });
        image.glsl = glslVariant(renderedCode, pixels, width, height);
      }
      image.glsl.code = savedImage.glsl.code;
      image.glsl.renderedCode = renderedCode;
      const mode = generator || savedImage.glsl.mode === "glsl" ? "glsl" : "original";
      applyImageVariant(image, mode);
    } catch (error) {
      console.warn("Saved GLSL state restore skipped.", error);
      image.glsl = null;
      image.original = null;
      image.mode = "original";
    }
  }
  image.pickers = savedPickers.filter((picker) => picker.x < image.width && picker.y < image.height);
  image.selection = savedSelection ? clampSavedRect(savedSelection, image.width, image.height) : null;
  image.window = {
    ...image.window,
    ...(savedImage.window || {})
  };
  if (image.elements) {
    image.elements.frame.dataset.id = String(image.id);
    image.elements.frame.querySelector(".window-title").textContent = image.name;
    updateImageWindowSize(image);
    updateImageModeTabs(image);
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
    hoveredPickerId = null;
    for (const image of images) {
      image.elements?.canvas.classList.remove("picker-hover");
    }
    updateHoveredPickerUi();
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
  requestRender();
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
  const savedScrollTop = pickerRows.scrollTop;
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
      row.dataset.pickerId = String(picker.id);
      row.classList.toggle("selected", picker.id === selectedPickerId);
      row.classList.toggle("hovered", picker.id === hoveredPickerId);
      row.addEventListener("click", () => {
        selectedPickerId = picker.id;
        selectImage(image);
        updatePickerPanel();
        requestRender();
      });

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
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removePicker(picker.id);
      });

      row.append(markerChip, sampleChip, label, value, remove);
      pickerRows.append(row);
    }
  }

  pickerCopyText.value = pickerCopyTextValue(rows);
  pickerRows.scrollTop = savedScrollTop;
  updateHoveredPickerUi();
}

function requestHoveredPickerUi({ scroll = false } = {}) {
  hoveredPickerUiScroll ||= scroll;
  if (hoveredPickerUiPending) return;
  hoveredPickerUiPending = true;
  requestAnimationFrame(() => {
    hoveredPickerUiPending = false;
    const shouldScroll = hoveredPickerUiScroll;
    hoveredPickerUiScroll = false;
    updateHoveredPickerUi({ scroll: shouldScroll });
  });
}

function updateHoveredPickerUi({ scroll = false } = {}) {
  const hovered = activePanelTab === "pickers"
    ? allPickers().find(({ picker }) => picker.id === hoveredPickerId) || null
    : null;
  for (const row of pickerRows.querySelectorAll(".picker-row.hovered")) {
    row.classList.remove("hovered");
  }
  if (!hovered) {
    hoveredPickerValue.textContent = "";
    return;
  }

  const row = pickerRows.querySelector(`[data-picker-id="${hovered.picker.id}"]`);
  row?.classList.add("hovered");
  if (scroll && row && activePanelTab === "pickers") {
    const listRect = pickerRows.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) {
      pickerRows.scrollTop -= listRect.top - rowRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      pickerRows.scrollTop += rowRect.bottom - listRect.bottom;
    }
  }

  const currentHoverId = hovered.picker.id;
  const linear = readDisplayedLinear(hovered.image, hovered.picker.x, hovered.picker.y, () => {
    if (hoveredPickerId === currentHoverId) requestHoveredPickerUi();
  });
  let modeLabel = { linear: "Linear", srgb: "sRGB", srgb255: "sRGB 255" }[pickerValueMode.value] || pickerValueMode.value;
  if (pickerValueMode.value === "linear" && hovered.image.valueUnit === "nit") modeLabel += " [nit]";
  hoveredPickerValue.textContent = linear
    ? `P${hovered.picker.id} ${modeLabel}: ${formatPickerValue(hovered.image, valuesFromLinear(linear, hovered.image))}`
    : `P${hovered.picker.id} ${modeLabel}: Loading...`;
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
    const unit = image.valueUnit === "nit" ? " nit" : "";
    summaryLines.push(
      `Min: ${formatChannelStats(stats.min, channels, image.valueUnit)}`,
      `Max: ${formatChannelStats(stats.max, channels, image.valueUnit)}`,
      `Average RGB: ${formatRgbStats(stats.average)}${unit}; Luminance ${formatNumber(stats.averageLuminance)}${unit}`
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
  if (image.rasterSource.asynchronous) {
    image.rasterSource.copyRegion(rect).then((pixels) => {
      if (selectionJobIsCurrent(image, rectKey, matrixKey, jobId)) {
        runSelectionWorker(image, rect, rectKey, matrixKey, valueMode, channels, pixels, jobId);
      }
    }).catch((error) => {
      if (jobId === selectionJobId) selectionDetailsInFlight = null;
      console.error("Selection tile read failed.", error);
    });
    return;
  }
  const pixels = new Float32Array(rect.width * rect.height * 4);
  let row = 0;
  const copyRows = () => {
    selectionCopyFrame = null;
    if (!selectionJobIsCurrent(image, rectKey, matrixKey, jobId)) {
      return;
    }
    const deadline = performance.now() + 2;
    do {
      const targetStart = row * rect.width * 4;
      image.rasterSource.copyRegionInto(
        { x: rect.x, y: rect.y + row, width: rect.width, height: 1 },
        pixels,
        targetStart
      );
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
    selectionWorker = new Worker(new URL("./selection-worker.js?v=20260810-3", import.meta.url), { type: "module" });
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
        texture: event.data.texture,
        matrixKey: null,
        matrix: ""
      });
      updateSelectionPanel();
      requestSelectionGraphDraw();
      return;
    }
    if (event.data.kind === "preview") {
      const cached = selectionDetailsCache.get(image);
      selectionDetailsCache.set(image, {
        rectKey,
        stats: cached?.rectKey === rectKey ? cached.stats : event.data.stats,
        pooled: cached?.rectKey === rectKey ? cached.pooled : event.data.pooled,
        texture: cached?.rectKey === rectKey ? cached.texture : event.data.texture,
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
    absoluteNits: image.valueUnit === "nit",
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
  if (rect.width * rect.height > MAX_VALUE_MATRIX_PIXELS) {
    fileHint.textContent = `Copy Matrix is limited to ${MAX_VALUE_MATRIX_PIXELS.toLocaleString("en-US")} pixels.`;
    return;
  }

  cancelSelectionMatrixCopy();
  const savedRect = { ...rect };
  const rectKey = selectionRectKey(image, savedRect);
  const matrixKey = selectionMatrixKey(image, savedRect);
  const valueMode = pickerValueMode.value;
  const channels = valueChannels(image).map((channel) => channel.index);
  const jobId = selectionMatrixCopyJobId;

  selectionMatrixCopyInFlight = { image, rectKey, matrixKey, jobId };
  copySelectionMatrixButton.disabled = true;
  copySelectionMatrixButton.textContent = "Preparing...";

  if (image.rasterSource.asynchronous) {
    image.rasterSource.copyRegion(savedRect).then((resolvedPixels) => {
      if (selectionMatrixCopyJobIsCurrent(image, matrixKey, jobId)) {
        runFullSelectionMatrixWorker(image, savedRect, matrixKey, valueMode, channels, resolvedPixels, jobId);
      }
    }).catch((error) => {
      console.error("Selection matrix tile read failed.", error);
      cancelSelectionMatrixCopy();
      updateSelectionPanel();
    });
    return;
  }

  const pixels = new Float32Array(savedRect.width * savedRect.height * 4);
  let row = 0;

  const copyRows = () => {
    selectionMatrixCopyFrame = null;
    if (!selectionMatrixCopyJobIsCurrent(image, matrixKey, jobId)) {
      cancelSelectionMatrixCopy();
      updateSelectionPanel();
      return;
    }
    const deadline = performance.now() + 2;
    do {
      const targetStart = row * savedRect.width * 4;
      image.rasterSource.copyRegionInto(
        { x: savedRect.x, y: savedRect.y + row, width: savedRect.width, height: 1 },
        pixels,
        targetStart
      );
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
    selectionMatrixCopyWorker = new Worker(new URL("./selection-worker.js?v=20260810-3", import.meta.url), { type: "module" });
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
    alphaWeighted: usesAlphaWeightedValues(image),
    absoluteNits: image.valueUnit === "nit"
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

async function selectionCsvText(image, rect) {
  const mode = pickerValueMode.value;
  const channels = valueChannels(image);
  const pixels = await image.rasterSource.copyRegion(rect);
  const lines = [["x", "y", "mode", "display", ...channels.map((channel) => channel.key)].join(",")];
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      lines.push([
        rect.x + x,
        rect.y + y,
        mode,
        displayChannelLabel(image),
        ...valueTupleForMode(
          valuesFromLinear(
            displayedLinearFromRgba(image, pixels.subarray((y * rect.width + x) * 4, (y * rect.width + x) * 4 + 4)),
            image
          ),
          mode,
          channels
        )
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
  const enabled = currentImage()?.settings?.logDisplay ?? logDisplayMode;
  logDisplayButton.classList.toggle("active", enabled);
  logDisplayButton.title = enabled
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
  const bounds = selectionGraphCanvas.getBoundingClientRect();
  const sampling = selectionGraphSampling(rect, bounds.width, bounds.height);
  const samplingLabel = sampling.stepped ? "" : sampling.downsampled ? " · Downsampled" : " · Interpolated";
  const graphLabel = `${rect.width} x ${rect.height} px ${graphModeLabel(image)}${samplingLabel}`;
  selectionGraphLabel.textContent = graphLabel;
  selectionGraphLabel.title = graphLabel;
  if (selectionGraphPanel.classList.contains("collapsed")) {
    return;
  }

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
  const normalize = graphValueNormalizer(min, max, image.settings.logDisplay ? "log" : "linear");
  const projector = makeGraphProjector(samples, rect, width, height, normalize);
  const colorTexture = sampling.downsampled
    ? selectionGraphColorTexture(image, rect, normalize, min, max)
    : null;
  const interactiveGraphDrag = activeDrag?.kind === "graphRotate" || activeDrag?.kind === "graphResize";

  graphCtx.save();
  drawGraphBase(samples, projector);

  if (samples.stepped) {
    drawSteppedGraph(samples, projector, normalize, min);
  } else {
    drawInterpolatedGraph(samples, projector, normalize, interactiveGraphDrag ? null : colorTexture);
  }

  drawGraphLegend(width, height, min, max, statistics, normalize);
  drawGraphSamplingNotice({ ...sampling, cols: samples.cols, rows: samples.rows }, colorTexture);
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

function selectionGraphSampling(
  rect,
  displayWidth = selectionGraphCanvas.clientWidth,
  displayHeight = selectionGraphCanvas.clientHeight
) {
  const selectionChanging = activeDrag?.kind === "selectRect";
  const graphInteraction = activeDrag?.kind === "graphRotate" || activeDrag?.kind === "graphResize";
  const stepped = !selectionChanging && rect.width <= 64 && rect.height <= 64;
  const colsLimit = selectionChanging
    ? 20
    : graphInteraction
      ? 64
      : adaptiveGraphMeshLimit(Math.max(1, displayWidth - 66));
  const rowsLimit = selectionChanging
    ? 20
    : graphInteraction
      ? 64
      : adaptiveGraphMeshLimit(Math.max(1, displayHeight - 30));
  const cols = stepped ? rect.width : Math.max(2, Math.min(colsLimit, rect.width));
  const rows = stepped ? rect.height : Math.max(2, Math.min(rowsLimit, rect.height));
  return {
    stepped,
    cols,
    rows,
    downsampled: cols < rect.width || rows < rect.height
  };
}

function adaptiveGraphMeshLimit(displayPixels) {
  const target = Math.max(64, Math.ceil(displayPixels / 7));
  return [64, 96, 128, 160].find((limit) => target <= limit) ?? 160;
}

function selectionGraphSamples(image, rect, sampling = selectionGraphSampling(rect)) {
  if (activeDrag?.kind !== "selectRect") {
    const cached = selectionDetailsCache.get(image);
    if (cached?.rectKey === selectionRectKey(image, rect) && cached.pooled) {
      const pooled = pooledGraphSamples(image, cached.pooled, sampling.cols, sampling.rows);
      if (pooled) {
        return { ...pooled, stepped: sampling.stepped };
      }
    }
  }

  // Until the worker's high-resolution average grid is ready, avoid issuing a
  // large number of direct reads (especially asynchronous tile reads).
  const stepped = sampling.stepped;
  const cols = stepped ? sampling.cols : Math.min(64, sampling.cols);
  const rows = stepped ? sampling.rows : Math.min(64, sampling.rows);
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

// Converts the worker's highest-resolution average grid to the mesh resolution
// selected for the current panel size.
function pooledGraphSamples(image, pooled, targetCols = pooled.cols, targetRows = pooled.rows) {
  const { cols, rows, values } = pooled;
  if (!cols || !rows || !values?.length) {
    return null;
  }
  const mode = image.settings.channel;
  const sourceGrid = [];
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      const index = (row * cols + col) * 4;
      line.push(channelValueFromRgba(
        mode,
        values[index],
        values[index + 1],
        values[index + 2],
        values[index + 3]
      ));
    }
    sourceGrid.push(line);
  }

  const outputCols = Math.max(1, Math.min(targetCols, cols));
  const outputRows = Math.max(1, Math.min(targetRows, rows));
  const grid = resampleGraphGrid(sourceGrid, cols, rows, outputCols, outputRows);
  let min = Infinity;
  let max = -Infinity;
  for (const line of grid) {
    for (const value of line) {
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }
  return { cols: outputCols, rows: outputRows, values: grid, min, max };
}

function resampleGraphGrid(source, sourceCols, sourceRows, targetCols, targetRows) {
  if (sourceCols === targetCols && sourceRows === targetRows) {
    return source;
  }
  const result = [];
  for (let targetRow = 0; targetRow < targetRows; targetRow += 1) {
    const sourceTop = targetRow * sourceRows / targetRows;
    const sourceBottom = (targetRow + 1) * sourceRows / targetRows;
    const firstSourceRow = Math.floor(sourceTop);
    const lastSourceRow = Math.min(sourceRows - 1, Math.ceil(sourceBottom) - 1);
    const line = [];
    for (let targetCol = 0; targetCol < targetCols; targetCol += 1) {
      const sourceLeft = targetCol * sourceCols / targetCols;
      const sourceRight = (targetCol + 1) * sourceCols / targetCols;
      const firstSourceCol = Math.floor(sourceLeft);
      const lastSourceCol = Math.min(sourceCols - 1, Math.ceil(sourceRight) - 1);
      let weightedSum = 0;
      let totalWeight = 0;
      for (let sourceRow = firstSourceRow; sourceRow <= lastSourceRow; sourceRow += 1) {
        const rowWeight = Math.min(sourceBottom, sourceRow + 1) - Math.max(sourceTop, sourceRow);
        for (let sourceCol = firstSourceCol; sourceCol <= lastSourceCol; sourceCol += 1) {
          const colWeight = Math.min(sourceRight, sourceCol + 1) - Math.max(sourceLeft, sourceCol);
          const weight = rowWeight * colWeight;
          const value = source[sourceRow][sourceCol];
          if (Number.isFinite(value) && weight > 0) {
            weightedSum += value * weight;
            totalWeight += weight;
          }
        }
      }
      line.push(totalWeight ? weightedSum / totalWeight : 0);
    }
    result.push(line);
  }
  return result;
}

function drawGraphSamplingNotice(sampling, texture = null) {
  if (sampling.stepped) {
    return;
  }
  const label = sampling.downsampled && texture
    ? `Mesh: ${sampling.cols} x ${sampling.rows} · Texture: ${texture.cols} x ${texture.rows}${texture.peakPooled ? " peak" : ""}`
    : sampling.downsampled
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
  const linear = readDisplayedLinear(image, x, y, requestSelectionGraphDraw);
  if (!linear) {
    return Number.NaN;
  }
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
  let label;
  if (mode === "r" || mode === "g" || mode === "b" || mode === "a") {
    label = mode.toUpperCase();
  } else {
    label = "Luminance";
  }
  return image.valueUnit === "nit" && mode !== "a" ? `${label} [nit]` : label;
}

function drawInterpolatedGraph(samples, projector, normalize, texture = null) {
  const quads = [];
  for (let row = 0; row < samples.rows - 1; row += 1) {
    for (let col = 0; col < samples.cols - 1; col += 1) {
      const v00 = samples.values[row][col];
      const v10 = samples.values[row][col + 1];
      const v11 = samples.values[row + 1][col + 1];
      const v01 = samples.values[row + 1][col];
      const avg = (v00 + v10 + v11 + v01) / 4;
      const u0 = texture ? col * texture.cols / (samples.cols - 1) : 0;
      const u1 = texture ? (col + 1) * texture.cols / (samples.cols - 1) : 0;
      const textureV0 = texture ? row * texture.rows / (samples.rows - 1) : 0;
      const textureV1 = texture ? (row + 1) * texture.rows / (samples.rows - 1) : 0;
      quads.push({
        depth: graphFaceDepth(projector, col, row, col + 1, row + 1),
        color: graphColor(normalize(avg)),
        texture: texture ? {
          canvas: texture.canvas,
          uvs: [
            { x: u0, y: textureV0 },
            { x: u1, y: textureV0 },
            { x: u1, y: textureV1 },
            { x: u0, y: textureV1 }
          ]
        } : null,
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
    traceGraphFace(face);
    graphCtx.globalAlpha = face.alpha;
    if (face.texture) {
      drawTexturedGraphFace(face);
    } else {
      graphCtx.fillStyle = face.color;
      graphCtx.fill();
    }
    graphCtx.globalAlpha = 1;
    graphCtx.strokeStyle = face.stroke;
    graphCtx.lineWidth = lineWidth;
    traceGraphFace(face);
    graphCtx.stroke();
  }
}

function traceGraphFace(face) {
  graphCtx.beginPath();
  graphCtx.moveTo(face.points[0].x, face.points[0].y);
  for (const point of face.points.slice(1)) {
    graphCtx.lineTo(point.x, point.y);
  }
  graphCtx.closePath();
}

function drawTexturedGraphFace(face) {
  drawTexturedGraphTriangle(face.texture.canvas, [
    { point: face.points[0], uv: face.texture.uvs[0] },
    { point: face.points[1], uv: face.texture.uvs[1] },
    { point: face.points[2], uv: face.texture.uvs[2] }
  ]);
  drawTexturedGraphTriangle(face.texture.canvas, [
    { point: face.points[0], uv: face.texture.uvs[0] },
    { point: face.points[2], uv: face.texture.uvs[2] },
    { point: face.points[3], uv: face.texture.uvs[3] }
  ]);
}

function drawTexturedGraphTriangle(canvas, vertices) {
  const [a, b, c] = vertices;
  const determinant =
    a.uv.x * (b.uv.y - c.uv.y) +
    b.uv.x * (c.uv.y - a.uv.y) +
    c.uv.x * (a.uv.y - b.uv.y);
  if (Math.abs(determinant) < 1e-8) {
    return;
  }

  const scaleX = (
    a.point.x * (b.uv.y - c.uv.y) +
    b.point.x * (c.uv.y - a.uv.y) +
    c.point.x * (a.uv.y - b.uv.y)
  ) / determinant;
  const skewX = (
    a.point.x * (c.uv.x - b.uv.x) +
    b.point.x * (a.uv.x - c.uv.x) +
    c.point.x * (b.uv.x - a.uv.x)
  ) / determinant;
  const offsetX = (
    a.point.x * (b.uv.x * c.uv.y - c.uv.x * b.uv.y) +
    b.point.x * (c.uv.x * a.uv.y - a.uv.x * c.uv.y) +
    c.point.x * (a.uv.x * b.uv.y - b.uv.x * a.uv.y)
  ) / determinant;
  const skewY = (
    a.point.y * (b.uv.y - c.uv.y) +
    b.point.y * (c.uv.y - a.uv.y) +
    c.point.y * (a.uv.y - b.uv.y)
  ) / determinant;
  const scaleY = (
    a.point.y * (c.uv.x - b.uv.x) +
    b.point.y * (a.uv.x - c.uv.x) +
    c.point.y * (b.uv.x - a.uv.x)
  ) / determinant;
  const offsetY = (
    a.point.y * (b.uv.x * c.uv.y - c.uv.x * b.uv.y) +
    b.point.y * (c.uv.x * a.uv.y - a.uv.x * c.uv.y) +
    c.point.y * (a.uv.x * b.uv.y - b.uv.x * a.uv.y)
  ) / determinant;
  const sourceX = Math.min(a.uv.x, b.uv.x, c.uv.x);
  const sourceY = Math.min(a.uv.y, b.uv.y, c.uv.y);
  const sourceWidth = Math.max(a.uv.x, b.uv.x, c.uv.x) - sourceX;
  const sourceHeight = Math.max(a.uv.y, b.uv.y, c.uv.y) - sourceY;

  graphCtx.save();
  graphCtx.beginPath();
  graphCtx.moveTo(a.point.x, a.point.y);
  graphCtx.lineTo(b.point.x, b.point.y);
  graphCtx.lineTo(c.point.x, c.point.y);
  graphCtx.closePath();
  graphCtx.clip();
  graphCtx.imageSmoothingEnabled = false;
  graphCtx.transform(scaleX, skewY, skewX, scaleY, offsetX, offsetY);
  graphCtx.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight
  );
  graphCtx.restore();
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
  const xDivisor = Math.max(1, pointCols - 1);
  const yDivisor = Math.max(1, pointRows - 1);
  const yawCos = Math.cos(graphView.yaw);
  const yawSin = Math.sin(graphView.yaw);
  const pitchCos = Math.cos(graphView.pitch);
  const pitchSin = Math.sin(graphView.pitch);
  const availableWidth = Math.max(20, plot.right - plot.left);
  const availableHeight = Math.max(20, plot.bottom - plot.top);
  const worldPoint = (col, row) => {
    const x = (col / xDivisor - 0.5) * worldWidth;
    const y = (row / yDivisor - 0.5) * worldDepth;
    return {
      viewX: x * yawCos - y * yawSin,
      viewY: x * yawSin + y * yawCos
    };
  };
  const projectPoint = (col, row, zRatio, worldHeight) => {
    const point = worldPoint(col, row);
    return {
      x: point.viewX,
      y: point.viewY * pitchCos - zRatio * worldHeight * pitchSin
    };
  };
  const extentCorners = [
    worldPoint(0, 0),
    worldPoint(pointCols - 1, 0),
    worldPoint(pointCols - 1, pointRows - 1),
    worldPoint(0, pointRows - 1)
  ];

  const graphExtent = (worldHeight) => {
    const result = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity
    };
    for (const point of extentCorners) {
      const baseY = point.viewY * pitchCos;
      const valueY = baseY - worldHeight * pitchSin;
      result.minX = Math.min(result.minX, point.viewX);
      result.maxX = Math.max(result.maxX, point.viewX);
      result.minY = Math.min(result.minY, baseY, valueY);
      result.maxY = Math.max(result.maxY, baseY, valueY);
    }
    return result;
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
    base: (col, row) => toCanvas(projectPoint(col, row, 0, worldHeight)),
    surface: (col, row, value) => toCanvas(projectPoint(col, row, normalize(value), worldHeight)),
    depth: (col, row) => worldPoint(col, row).viewY
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
const graphColorStops = [
  [0, 0, 70],
  [0, 74, 255],
  [0, 220, 255],
  [0, 210, 72],
  [255, 238, 0],
  [255, 0, 0]
];

function graphColorComponents(value) {
  const t = clamp01(value);
  const scaled = t * (graphColorStops.length - 1);
  const index = Math.min(graphColorStops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = graphColorStops[index];
  const b = graphColorStops[index + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * local);
  const g = Math.round(a[1] + (b[1] - a[1]) * local);
  const blue = Math.round(a[2] + (b[2] - a[2]) * local);
  return [r, g, blue];
}

function graphColor(value) {
  const [r, g, blue] = graphColorComponents(value);
  return `rgb(${r} ${g} ${blue})`;
}

function selectionGraphColorTexture(image, rect, normalize, min, max) {
  const cached = selectionDetailsCache.get(image);
  const rectKey = selectionRectKey(image, rect);
  const texture = cached?.rectKey === rectKey ? cached.texture : null;
  if (!texture?.values?.length || !texture.cols || !texture.rows) {
    return null;
  }

  const mode = image.settings.channel;
  const component = { r: 0, g: 1, b: 2, a: 3 }[mode] ?? 4;
  const renderKey = `${mode}:${image.settings.logDisplay ? "log" : "linear"}:${min}:${max}`;
  if (texture.canvas && texture.renderKey === renderKey) {
    return texture;
  }

  const canvas = texture.canvas || document.createElement("canvas");
  canvas.width = texture.cols;
  canvas.height = texture.rows;
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(texture.cols, texture.rows);
  const componentCount = texture.componentCount || 5;
  for (let pixelIndex = 0; pixelIndex < texture.cols * texture.rows; pixelIndex += 1) {
    const value = texture.values[pixelIndex * componentCount + component];
    const [r, g, b] = graphColorComponents(normalize(value));
    const targetIndex = pixelIndex * 4;
    imageData.data[targetIndex] = r;
    imageData.data[targetIndex + 1] = g;
    imageData.data[targetIndex + 2] = b;
    imageData.data[targetIndex + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  texture.canvas = canvas;
  texture.renderKey = renderKey;
  return texture;
}

function forEachPixelInRect(image, rect, callback) {
  const alphaWeighted = usesAlphaWeightedValues(image);
  const rgba = new Float32Array(4);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      image.rasterSource.getPixel(rect.x + x, rect.y + y, rgba);
      const alpha = rgba[3];
      const scale = alphaWeighted ? alpha : 1;
      callback([
        rgba[0] * scale,
        rgba[1] * scale,
        rgba[2] * scale,
        alpha
      ], rect.x + x, rect.y + y);
    }
  }
}

function pixelTupleForMode(image, x, y, mode, channels = valueChannels(image)) {
  const linear = readDisplayedLinear(image, x, y);
  return linear ? valueTupleForMode(valuesFromLinear(linear, image), mode, channels) : channels.map(() => Number.NaN);
}

// RGBA 表示ではキャンバス上で色に alpha が乗った状態（黒背景との合成結果）が見えているため、
// 値の取得も alpha 乗算後にそろえる。RGB / 単チャンネル表示は alpha を乗算しない。
function usesAlphaWeightedValues(image) {
  return image.settings.channel === "rgba";
}

function readDisplayedLinear(image, x, y, onResolved = null) {
  const rgba = image.rasterSource.getPixel(x, y);
  if (rgba && typeof rgba.then === "function") {
    rgba.then((resolved) => onResolved?.(displayedLinearFromRgba(image, resolved))).catch((error) => {
      console.error("Pixel read failed.", error);
    });
    return null;
  }
  return displayedLinearFromRgba(image, rgba);
}

function displayedLinearFromRgba(image, rgba) {
  const alpha = rgba[3];
  const scale = usesAlphaWeightedValues(image) ? alpha : 1;
  return [
    rgba[0] * scale,
    rgba[1] * scale,
    rgba[2] * scale,
    alpha
  ];
}

function valuesFromLinear(linear, image = null) {
  const displayLinear = image ? displayPreviewLinear(image, linear) : linear;
  const srgb = [
    linearToSrgb(displayLinear[0]),
    linearToSrgb(displayLinear[1]),
    linearToSrgb(displayLinear[2]),
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
  const linear = readDisplayedLinear(image, picker.x, picker.y, () => {
    updatePickerPanel();
  });
  return linear ? valuesFromLinear(linear, image) : { ...valuesFromLinear([0, 0, 0, 0], image), pending: true };
}

function formatPickerValue(image, values) {
  if (values.pending) {
    return "Loading...";
  }
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

function formatChannelStats(values, channels, valueUnit = "relative") {
  return channels.map((channel) => {
    const unit = valueUnit === "nit" && channel.index < 3 ? " nit" : "";
    return `${channel.label} ${formatNumber(values[channel.index])}${unit}`;
  }).join(", ");
}

function sampleCssColor(image, linear) {
  const display = displayChannels(linear, image.settings.channel);
  const preview = image.valueUnit === "nit"
    ? [...toneMapAbsoluteRgb(display[0], display[1], display[2], image.settings.brightness), display[3]]
    : display;
  const r = Math.round(clamp01(linearToSrgb(preview[0])) * 255);
  const g = Math.round(clamp01(linearToSrgb(preview[1])) * 255);
  const b = Math.round(clamp01(linearToSrgb(preview[2])) * 255);
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
  let luminanceMin = Infinity;
  let luminanceMax = -Infinity;

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
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (Number.isFinite(luminance)) {
      if (luminance < luminanceMin) luminanceMin = luminance;
      if (luminance > luminanceMax) luminanceMax = luminance;
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
    rgbMax: Math.max(max[0], max[1], max[2]),
    luminanceMin: luminanceMin === Infinity ? 0 : luminanceMin,
    luminanceMax: luminanceMax === -Infinity ? 0 : luminanceMax
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
  updateLogDisplayButton();
  emptySettings.classList.toggle("hidden", Boolean(image));
  settingsForm.classList.toggle("hidden", !image);
  if (!image) {
    return;
  }

  zoomSelect.value = matchingZoomValue(image);
  filterSelect.value = image.settings.filter;
  autoLevelInput.checked = image.settings.autoLevel;
  brightnessInput.value = String(image.settings.brightness);
  pickerValueMode.options[0].textContent = image.valueUnit === "nit" ? "Linear [nit]" : "Linear";
  updateSaveFormatOptions(image);
  metaName.textContent = image.name;
  metaSize.textContent = image.downsample > 1
    ? `${image.sourceWidth} x ${image.sourceHeight} → ${image.width} x ${image.height} (1/${image.downsample} preview)`
    : `${image.width} x ${image.height}`;
  metaType.textContent = `${image.type} / ${image.sourceFormat}`;
  const normalizationRange = getDisplayNormalizationRange(image);
  if (image.valueUnit === "nit" && image.settings.channel !== "a") {
    metaRange.textContent = `${formatNumber(normalizationRange.min)} - ${formatNumber(normalizationRange.max)} nit; Y ${formatNumber(image.range.luminanceMin)} - ${formatNumber(image.range.luminanceMax)} nit`;
  } else {
    metaRange.textContent = `${formatNumber(normalizationRange.min)} - ${formatNumber(normalizationRange.max)}`;
  }

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
  if (image.sourceFormat === "glsl" || image.sourceFormat === "values") {
    // GLSL 出力と値マトリクスは元フォーマットの制約が無いので、すべての形式で書き出せる
    return ["png", "jpeg", "webp", "hdr", "exr"];
  }
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

  drawImageTiles(image, ctx, width, height, dpr);
  drawPixelGrid(image, ctx, width, height);
  drawPickers(image, ctx);
  drawSelection(image, ctx);
}

const displayTileSize = RASTER_TILE_SIZE;
const displayTileGutter = 1;
const maxCachedDisplayTiles = 96;

function drawImageTiles(image, ctx, canvasWidth, canvasHeight, dpr) {
  if (!image.rasterSource || image.width < 1 || image.height < 1 || image.view.scale <= 0) {
    return;
  }
  const cache = displayTileCache(image);
  drawImageOverview(image, ctx);
  const sourcePixelsPerDevicePixel = 1 / Math.max(0.000001, image.view.scale * dpr);
  const maximumLevel = Math.max(0, Math.ceil(Math.log2(Math.max(image.width, image.height))));
  const level = clamp(Math.floor(Math.log2(Math.max(1, sourcePixelsPerDevicePixel))), 0, maximumLevel);
  const factor = 2 ** level;
  const levelWidth = Math.ceil(image.width / factor);
  const levelHeight = Math.ceil(image.height / factor);

  const sourceLeft = Math.max(0, (-image.view.offsetX) / image.view.scale);
  const sourceTop = Math.max(0, (-image.view.offsetY) / image.view.scale);
  const sourceRight = Math.min(image.width, (canvasWidth - image.view.offsetX) / image.view.scale);
  const sourceBottom = Math.min(image.height, (canvasHeight - image.view.offsetY) / image.view.scale);
  if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) {
    return;
  }

  const firstTileX = clamp(Math.floor(sourceLeft / factor / displayTileSize), 0, Math.ceil(levelWidth / displayTileSize) - 1);
  const lastTileX = clamp(Math.floor((sourceRight - 1) / factor / displayTileSize), 0, Math.ceil(levelWidth / displayTileSize) - 1);
  const firstTileY = clamp(Math.floor(sourceTop / factor / displayTileSize), 0, Math.ceil(levelHeight / displayTileSize) - 1);
  const lastTileY = clamp(Math.floor((sourceBottom - 1) / factor / displayTileSize), 0, Math.ceil(levelHeight / displayTileSize) - 1);

  ctx.imageSmoothingEnabled = shouldSmooth(image);
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const tile = getDisplayTile(image, cache, level, tileX, tileY);
      if (!tile) {
        continue;
      }
      const sourceX = tileX * displayTileSize * factor;
      const sourceY = tileY * displayTileSize * factor;
      const sourceWidth = Math.min(tile.width * factor, image.width - sourceX);
      const sourceHeight = Math.min(tile.height * factor, image.height - sourceY);
      ctx.drawImage(
        tile.canvas,
        displayTileGutter,
        displayTileGutter,
        tile.width,
        tile.height,
        image.view.offsetX + sourceX * image.view.scale,
        image.view.offsetY + sourceY * image.view.scale,
        sourceWidth * image.view.scale,
        sourceHeight * image.view.scale
      );
    }
  }
}

function displayTileCache(image) {
  image.displayTileCache ||= new Map();
  if (image.displayDirty) {
    image.displayTileCache.clear();
    image.displayOverview = null;
    image.displayDirty = false;
  }
  return image.displayTileCache;
}

function drawImageOverview(image, ctx) {
  const overview = image.overview;
  if (!overview?.pixels || overview.width < 1 || overview.height < 1) return;
  if (!image.displayOverview) {
    image.displayOverview = createDisplayTile(image, {
      width: overview.width,
      height: overview.height,
      gutter: 0,
      stride: overview.width,
      pixels: overview.pixels
    });
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(
    image.displayOverview.canvas,
    0,
    0,
    overview.width,
    overview.height,
    image.view.offsetX,
    image.view.offsetY,
    image.width * image.view.scale,
    image.height * image.view.scale
  );
}

function getDisplayTile(image, cache, level, tileX, tileY) {
  const key = `${level}:${tileX}:${tileY}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const sourceTile = image.rasterSource.getTile(level, tileX, tileY, displayTileGutter);
  if (sourceTile && typeof sourceTile.then === "function") {
    image.pendingDisplayTiles ||= new Map();
    if (!image.pendingDisplayTiles.has(key)) {
      const pending = sourceTile.then((resolved) => {
        image.pendingDisplayTiles.delete(key);
        const tile = createDisplayTile(image, resolved);
        cache.set(key, tile);
        trimDisplayTileCache(cache);
        requestRender();
      }).catch((error) => {
        image.pendingDisplayTiles.delete(key);
        console.error("Raster tile failed.", error);
        fileHint.textContent = `Tile failed: ${error?.message || error}`;
      });
      image.pendingDisplayTiles.set(key, pending);
    }
    return null;
  }
  const tile = createDisplayTile(image, sourceTile);
  cache.set(key, tile);
  trimDisplayTileCache(cache);
  return tile;
}

function trimDisplayTileCache(cache) {
  while (cache.size > maxCachedDisplayTiles) cache.delete(cache.keys().next().value);
}

function createDisplayTile(image, sourceTile) {
  const { width, height, gutter, stride, pixels } = sourceTile;
  const canvas = document.createElement("canvas");
  canvas.width = width + gutter * 2;
  canvas.height = height + gutter * 2;
  const context = canvas.getContext("2d", { alpha: false });
  const imageData = context.createImageData(canvas.width, canvas.height);
  const target = imageData.data;
  const display = displayConversion(image);

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      writeDisplayPixel(target, offset, pixels, (y * stride + x) * 4, display);
    }
  }
  context.putImageData(imageData, 0, 0);
  return { canvas, width, height };
}

function displayConversion(image) {
  const range = getDisplayNormalizationRange(image);
  const width = range.max - range.min;
  return {
    mode: image.settings.channel,
    brightness: image.settings.brightness,
    autoLevel: image.settings.autoLevel && width > 0,
    absoluteNits: image.valueUnit === "nit",
    levelOffset: range.min,
    levelScale: width > 0 ? 1 / width : 1,
    logNormalize: image.settings.logDisplay ? graphValueNormalizer(range.min, range.max, "log") : null
  };
}

function writeDisplayPixel(target, offset, source, sourceOffset, display) {
  if (display.mode === "a") {
    let alpha = source[sourceOffset + 3];
    if (display.logNormalize) {
      alpha = display.logNormalize(alpha * display.brightness);
    } else if (display.autoLevel) {
      alpha = clamp01((alpha - display.levelOffset) * display.levelScale * display.brightness);
    } else {
      alpha = clamp01(alpha * display.brightness);
    }
    const byte = Math.round(alpha * 255);
    target[offset] = byte;
    target[offset + 1] = byte;
    target[offset + 2] = byte;
    target[offset + 3] = 255;
    return;
  }

  let sourceR = 0;
  let sourceG = 1;
  let sourceB = 2;
  if (display.mode === "r" || display.mode === "g" || display.mode === "b") {
    sourceR = display.mode === "r" ? 0 : display.mode === "g" ? 1 : 2;
    sourceG = sourceR;
    sourceB = sourceR;
  }
  if (display.absoluteNits && !display.logNormalize && !display.autoLevel) {
    const preview = toneMapAbsoluteRgb(
      source[sourceOffset + sourceR],
      source[sourceOffset + sourceG],
      source[sourceOffset + sourceB],
      display.brightness
    );
    target[offset] = linearToSrgbByte(preview[0]);
    target[offset + 1] = linearToSrgbByte(preview[1]);
    target[offset + 2] = linearToSrgbByte(preview[2]);
    target[offset + 3] = display.mode === "rgba" ? Math.round(clamp01(source[sourceOffset + 3]) * 255) : 255;
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const channelOffset = channel === 0 ? sourceR : channel === 1 ? sourceG : sourceB;
    const value = source[sourceOffset + channelOffset];
    target[offset + channel] = display.logNormalize
      ? Math.round(display.logNormalize(value * display.brightness) * 255)
      : display.autoLevel
        ? linearToSrgbByte((value - display.levelOffset) * display.levelScale * display.brightness)
        : linearToSrgbByte(value * display.brightness);
  }
  target[offset + 3] = display.mode === "rgba" ? Math.round(clamp01(source[sourceOffset + 3]) * 255) : 255;
}

function displayPreviewLinear(image, linear) {
  if (image?.valueUnit !== "nit") {
    return linear;
  }
  // Numeric sRGB preview stays independent of the View Settings brightness,
  // matching the existing picker/matrix contract for relative images.
  const mapped = toneMapAbsoluteRgb(linear[0], linear[1], linear[2], 1);
  return [mapped[0], mapped[1], mapped[2], linear[3]];
}

function toneMapAbsoluteRgb(redNits, greenNits, blueNits, brightness = 1) {
  const red = Number.isFinite(redNits) ? redNits : 0;
  const green = Number.isFinite(greenNits) ? greenNits : 0;
  const blue = Number.isFinite(blueNits) ? blueNits : 0;
  const luminance = Math.max(0, 0.2126 * red + 0.7152 * green + 0.0722 * blue);
  if (luminance <= 1e-9) {
    return [0, 0, 0];
  }
  // SDR preview only. Measurement pixels remain untouched in absolute cd/m².
  const mappedLuminance = acesToneMap(luminance / 100 * Math.max(0, brightness));
  const scale = mappedLuminance / luminance;
  return fitLinearSrgbGamut(red * scale, green * scale, blue * scale, mappedLuminance);
}

function acesToneMap(value) {
  const x = Math.max(0, value) * 0.6;
  return clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

function fitLinearSrgbGamut(red, green, blue, luminance) {
  let saturation = 1;
  for (const channel of [red, green, blue]) {
    if (channel < 0 && channel < luminance) {
      saturation = Math.min(saturation, luminance / (luminance - channel));
    } else if (channel > 1 && channel > luminance) {
      saturation = Math.min(saturation, (1 - luminance) / (channel - luminance));
    }
  }
  const safeSaturation = clamp01(saturation);
  return [
    clamp01(luminance + (red - luminance) * safeSaturation),
    clamp01(luminance + (green - luminance) * safeSaturation),
    clamp01(luminance + (blue - luminance) * safeSaturation)
  ];
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

let pixelReadoutRequestId = 0;

function updatePixelReadout(image, event) {
  const pixel = pixelFromEvent(image, event);
  if (!pixel) {
    clearPixelReadout();
    return;
  }

  const requestId = ++pixelReadoutRequestId;
  const apply = (linear) => {
    if (requestId !== pixelReadoutRequestId || !linear) return;
    const values = valuesFromLinear(linear, image);
    const unit = image.valueUnit === "nit" ? " [nit]" : "";
    pixelPosition.textContent = `x: ${pixel.x}, y: ${pixel.y}`;
    linearValue.textContent = `Linear${unit}: ${formatTuple(linear)}`;
    srgbValue.textContent = `${image.valueUnit === "nit" ? "sRGB preview" : "sRGB"}: ${formatTuple(values.srgb)}`;
  };
  const linear = readDisplayedLinear(image, pixel.x, pixel.y, apply);
  if (!linear) {
    pixelPosition.textContent = `x: ${pixel.x}, y: ${pixel.y}`;
    linearValue.textContent = "Linear: Loading...";
    srgbValue.textContent = "sRGB: Loading...";
    return;
  }
  apply(linear);
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
