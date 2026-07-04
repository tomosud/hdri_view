import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

const fileInput = document.querySelector("#fileInput");
const fileHint = document.querySelector("#fileHint");
const viewport = document.querySelector("#viewport");
const windowLayer = document.querySelector("#windowLayer");
const dropPrompt = document.querySelector("#dropPrompt");
const emptySettings = document.querySelector("#emptySettings");
const settingsForm = document.querySelector("#settingsForm");
const zoomSelect = document.querySelector("#zoomSelect");
const filterSelect = document.querySelector("#filterSelect");
const autoLevelInput = document.querySelector("#autoLevelInput");
const brightnessInput = document.querySelector("#brightnessInput");
const brightnessReset = document.querySelector("#brightnessReset");
const channelButtons = document.querySelector("#channelButtons");
const metaName = document.querySelector("#metaName");
const metaSize = document.querySelector("#metaSize");
const metaType = document.querySelector("#metaType");
const metaRange = document.querySelector("#metaRange");
const pixelPosition = document.querySelector("#pixelPosition");
const linearValue = document.querySelector("#linearValue");
const srgbValue = document.querySelector("#srgbValue");
const viewState = document.querySelector("#viewState");

const images = [];
const minWindowWidth = 220;
const minWindowHeight = 160;

let selectedId = null;
let nextId = 1;
let topZ = 10;
let activeDrag = null;
let rafPending = false;

fileInput.addEventListener("change", () => {
  void openFiles(fileInput.files);
  fileInput.value = "";
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
  void openFiles(event.dataTransfer.files, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  });
});

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
});

autoLevelInput.addEventListener("change", () => {
  const image = currentImage();
  if (!image) {
    return;
  }
  image.settings.autoLevel = autoLevelInput.checked;
  image.displayDirty = true;
  requestRender();
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
});

channelButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-channel]");
  const image = currentImage();
  if (!button || !image) {
    return;
  }
  image.settings.channel = button.dataset.channel;
  image.displayDirty = true;
  updateSettingsPanel();
  requestRender();
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
    activeDrag.image.window.x = activeDrag.x + dx;
    activeDrag.image.window.y = activeDrag.y + dy;
    applyWindowGeometry(activeDrag.image);
  } else if (activeDrag.kind === "resize") {
    activeDrag.image.window.width = Math.max(minWindowWidth, activeDrag.width + dx);
    activeDrag.image.window.height = Math.max(minWindowHeight, activeDrag.height + dy);
    activeDrag.image.view.fit = false;
    applyWindowGeometry(activeDrag.image);
    requestRender();
  }
});

document.addEventListener("pointerup", () => {
  activeDrag = null;
});

requestRender();

async function openFiles(fileList, dropPoint = null) {
  const files = Array.from(fileList || []).filter((file) => file.size > 0);
  if (files.length === 0) {
    return;
  }

  fileHint.textContent = `Loading ${files.length} file${files.length === 1 ? "" : "s"}...`;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const image = await loadImageFile(file);
      images.push(image);
      createImageWindow(image, dropPoint, index);
      selectImage(image);
      fitImageToWindow(image, false);
      requestRender();
    } catch (error) {
      console.error(error);
      fileHint.textContent = `Failed: ${file.name}`;
    }
  }

  dropPrompt.classList.toggle("hidden", images.length > 0);
  fileHint.textContent = `${images.length} image${images.length === 1 ? "" : "s"} opened`;
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
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none" }).catch(() => createImageBitmap(file));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = bitmap.width;
  sourceCanvas.height = bitmap.height;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const pixels = new Float32Array(sourceCanvas.width * sourceCanvas.height * 4);
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 4) {
    pixels[j] = srgbToLinear(imageData.data[i] / 255);
    pixels[j + 1] = srgbToLinear(imageData.data[i + 1] / 255);
    pixels[j + 2] = srgbToLinear(imageData.data[i + 2] / 255);
    pixels[j + 3] = imageData.data[i + 3] / 255;
  }

  return createImageRecord(file, sourceCanvas.width, sourceCanvas.height, "raster/srgb", pixels);
}

async function loadDataTexture(file, kind) {
  const buffer = await file.arrayBuffer();
  const loader = kind === "exr" ? new EXRLoader() : new RGBELoader();
  if (typeof loader.setDataType === "function") {
    loader.setDataType(THREE.FloatType);
  }
  const parsed = loader.parse(buffer);
  const { data, width, height } = extractTextureData(parsed);
  const itemSize = Math.max(1, Math.round(data.length / (width * height)));
  const pixels = new Float32Array(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceIndex = pixel * itemSize;
    const targetIndex = pixel * 4;
    pixels[targetIndex] = readTextureValue(data, sourceIndex);
    pixels[targetIndex + 1] = readTextureValue(data, sourceIndex + Math.min(1, itemSize - 1));
    pixels[targetIndex + 2] = readTextureValue(data, sourceIndex + Math.min(2, itemSize - 1));
    pixels[targetIndex + 3] = itemSize >= 4 ? readTextureValue(data, sourceIndex + 3) : 1;
  }

  parsed.dispose?.();
  return createImageRecord(file, width, height, kind === "exr" ? "openexr/linear" : "radiance-hdr/linear", pixels);
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

function createImageRecord(file, width, height, type, pixels) {
  const id = nextId;
  nextId += 1;
  const range = computeRange(pixels);
  return {
    id,
    name: file.name,
    width,
    height,
    type,
    pixels,
    range,
    settings: {
      autoLevel: false,
      brightness: 1,
      channel: "rgba",
      filter: "auto"
    },
    view: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      fit: true
    },
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
  titlebar.innerHTML = `<div class="window-title"></div><div class="window-size"></div>`;
  titlebar.querySelector(".window-title").textContent = image.name;
  titlebar.querySelector(".window-size").textContent = `${image.width}x${image.height}`;

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
    resizeHandle
  };

  frame.addEventListener("pointerdown", () => selectImage(image));

  titlebar.addEventListener("pointerdown", (event) => {
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
  updateViewState();
}

function applyWindowGeometry(image) {
  const { frame } = image.elements;
  frame.style.left = `${image.window.x}px`;
  frame.style.top = `${image.window.y}px`;
  frame.style.width = `${image.window.width}px`;
  frame.style.height = `${image.window.height}px`;
  frame.style.zIndex = String(image.window.z);
}

function computeRange(pixels) {
  const min = [Infinity, Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pixels.length; i += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      const value = pixels[i + channel];
      if (!Number.isFinite(value)) {
        continue;
      }
      min[channel] = Math.min(min[channel], value);
      max[channel] = Math.max(max[channel], value);
    }
  }

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
  metaName.textContent = image.name;
  metaSize.textContent = `${image.width} x ${image.height}`;
  metaType.textContent = image.type;
  metaRange.textContent = `${formatNumber(image.range.rgbMin)} - ${formatNumber(image.range.rgbMax)}`;

  for (const button of channelButtons.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.channel === image.settings.channel);
  }
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

  ensureDisplayCanvas(image);
  ctx.imageSmoothingEnabled = shouldSmooth(image);
  ctx.drawImage(
    image.displayCanvas,
    image.view.offsetX,
    image.view.offsetY,
    image.width * image.view.scale,
    image.height * image.view.scale
  );
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
  const rgbRange = image.range.rgbMax - image.range.rgbMin;
  const alphaRange = image.range.max[3] - image.range.min[3];
  const brightness = image.settings.brightness;

  for (let i = 0, j = 0; i < image.pixels.length; i += 4, j += 4) {
    const source = [
      image.pixels[i],
      image.pixels[i + 1],
      image.pixels[i + 2],
      image.pixels[i + 3]
    ];
    const display = displayChannels(source, image.settings.channel);

    for (let channel = 0; channel < 3; channel += 1) {
      let value = display[channel];
      if (image.settings.autoLevel && rgbRange > 0) {
        value = (value - image.range.rgbMin) / rgbRange;
      }
      imageData.data[j + channel] = Math.round(clamp01(linearToSrgb(value * brightness)) * 255);
    }

    let alpha = display[3];
    if (image.settings.channel === "a") {
      if (image.settings.autoLevel && alphaRange > 0) {
        alpha = (source[3] - image.range.min[3]) / alphaRange;
      }
      imageData.data[j] = Math.round(clamp01(alpha * brightness) * 255);
      imageData.data[j + 1] = imageData.data[j];
      imageData.data[j + 2] = imageData.data[j];
      imageData.data[j + 3] = 255;
    } else {
      imageData.data[j + 3] = Math.round(clamp01(alpha) * 255);
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
}

function updatePixelReadout(image, event) {
  const rect = image.elements.canvas.getBoundingClientRect();
  const viewX = event.clientX - rect.left;
  const viewY = event.clientY - rect.top;
  const x = Math.floor((viewX - image.view.offsetX) / image.view.scale);
  const y = Math.floor((viewY - image.view.offsetY) / image.view.scale);

  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    clearPixelReadout();
    return;
  }

  const index = (y * image.width + x) * 4;
  const linear = [
    image.pixels[index],
    image.pixels[index + 1],
    image.pixels[index + 2],
    image.pixels[index + 3]
  ];
  const srgb = [
    linearToSrgb(linear[0]),
    linearToSrgb(linear[1]),
    linearToSrgb(linear[2]),
    linear[3]
  ];

  pixelPosition.textContent = `x: ${x}, y: ${y}`;
  linearValue.textContent = `Linear: ${formatTuple(linear)}`;
  srgbValue.textContent = `sRGB: ${formatTuple(srgb)}`;
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
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.0001 || abs >= 10000)) {
    return value.toExponential(5);
  }
  return value.toFixed(abs < 10 ? 6 : 3).replace(/\.?0+$/, "");
}
