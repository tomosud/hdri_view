export const RASTER_TILE_SIZE = 512;

export function createWorkerRasterSource(worker, metadata, { maxCachedTiles = 24 } = {}) {
  const { width, height } = metadata;
  let initialPreview = metadata.initialPreview || null;
  if (!(worker instanceof Worker) || width < 1 || height < 1) {
    throw new Error("Worker raster source requires a Worker and valid dimensions.");
  }
  const cache = new Map();
  const inFlightTiles = new Map();
  const requests = new Map();
  let nextRequestId = 1;
  let disposed = false;

  const rejectAll = (error) => {
    for (const request of requests.values()) request.reject(error);
    requests.clear();
    inFlightTiles.clear();
  };
  worker.addEventListener("message", (event) => {
    const message = event.data || {};
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    if (message.type === "error") request.reject(new Error(message.message || "Raster worker request failed."));
    else request.resolve(message.result || message);
  });
  worker.addEventListener("error", (event) => rejectAll(new Error(event.message || "Raster worker failed.")));

  const request = (operation, payload = {}) => {
    if (disposed) return Promise.reject(new Error("Worker raster source is closed."));
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject });
      worker.postMessage({ id, type: "raster-request", operation, ...payload });
    });
  };

  return {
    ...metadata,
    pixels: null,
    asynchronous: true,
    getTile(level, tileX, tileY, gutter = 1) {
      const key = `${level}:${tileX}:${tileY}:${gutter}`;
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }
      const existing = inFlightTiles.get(key);
      if (existing) return existing;
      const promise = request("tile", { level, tileX, tileY, gutter }).then((result) => {
        const tile = { ...result, pixels: new Float32Array(result.pixels) };
        inFlightTiles.delete(key);
        cache.set(key, tile);
        while (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value);
        return tile;
      }, (error) => {
        inFlightTiles.delete(key);
        throw error;
      });
      inFlightTiles.set(key, promise);
      return promise;
    },
    getPixel(x, y, target = new Float32Array(4)) {
      const tileX = Math.floor(x / RASTER_TILE_SIZE);
      const tileY = Math.floor(y / RASTER_TILE_SIZE);
      const tile = this.getTile(0, tileX, tileY, 0);
      const read = (resolved) => {
        const offset = ((y - tileY * RASTER_TILE_SIZE) * resolved.stride + x - tileX * RASTER_TILE_SIZE) * 4;
        target.set(resolved.pixels.subarray(offset, offset + 4));
        return target;
      };
      return tile && typeof tile.then === "function" ? tile.then(read) : read(tile);
    },
    async copyRegion(rect) {
      const result = await request("region", { rect });
      return new Float32Array(result.pixels);
    },
    async materialize() {
      return this.copyRegion({ x: 0, y: 0, width, height });
    },
    readPreview(maximumEdge = 1024) {
      if (initialPreview) {
        return initialPreview;
      }
      return request("preview", { maximumEdge }).then((result) => ({
        ...result,
        pixels: new Float32Array(result.pixels)
      }));
    },
    clearCache() {
      cache.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      initialPreview = null;
      cache.clear();
      rejectAll(new Error("Worker raster source was closed."));
      worker.postMessage({ type: "raster-dispose" });
      worker.terminate();
    }
  };
}

export function createMemoryRasterSource(pixels, width, height, { maxCachedTiles = 24 } = {}) {
  if (!(pixels instanceof Float32Array) || pixels.length !== width * height * 4) {
    throw new Error("Raster source requires width x height linear Float32 RGBA pixels.");
  }
  const cache = new Map();
  return {
    width,
    height,
    pixels,
    getTile(level, tileX, tileY, gutter = 1) {
      const key = `${level}:${tileX}:${tileY}:${gutter}`;
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }
      const tile = buildTile(pixels, width, height, level, tileX, tileY, gutter);
      cache.set(key, tile);
      while (cache.size > maxCachedTiles) {
        cache.delete(cache.keys().next().value);
      }
      return tile;
    },
    getPixel(x, y, target = new Float32Array(4)) {
      const source = (y * width + x) * 4;
      target[0] = pixels[source];
      target[1] = pixels[source + 1];
      target[2] = pixels[source + 2];
      target[3] = pixels[source + 3];
      return target;
    },
    copyRegion(rect) {
      const output = new Float32Array(rect.width * rect.height * 4);
      copyRegionInto(pixels, width, rect, output, 0);
      return output;
    },
    copyRegionInto(rect, target, targetOffset = 0) {
      copyRegionInto(pixels, width, rect, target, targetOffset);
      return target;
    },
    materialize() {
      return pixels;
    },
    clearCache() {
      cache.clear();
    },
    dispose() {
      cache.clear();
    }
  };
}

export function createBitmapRasterSource(bitmap, { maxCachedTiles = 24 } = {}) {
  if (!bitmap || bitmap.width < 1 || bitmap.height < 1) {
    throw new Error("Bitmap raster source requires a valid ImageBitmap.");
  }
  const { width, height } = bitmap;
  const cache = new Map();
  let disposed = false;
  return {
    width,
    height,
    pixels: null,
    getTile(level, tileX, tileY, gutter = 1) {
      if (disposed) throw new Error("Bitmap raster source is closed.");
      const key = `${level}:${tileX}:${tileY}:${gutter}`;
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }
      const tile = buildBitmapTile(bitmap, level, tileX, tileY, gutter);
      cache.set(key, tile);
      while (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value);
      return tile;
    },
    getPixel(x, y, target = new Float32Array(4)) {
      const tileX = Math.floor(x / RASTER_TILE_SIZE);
      const tileY = Math.floor(y / RASTER_TILE_SIZE);
      const tile = this.getTile(0, tileX, tileY, 0);
      const offset = ((y - tileY * RASTER_TILE_SIZE) * tile.stride + x - tileX * RASTER_TILE_SIZE) * 4;
      target.set(tile.pixels.subarray(offset, offset + 4));
      return target;
    },
    copyRegion(rect) {
      const output = new Float32Array(rect.width * rect.height * 4);
      copyBitmapRegion(this, rect, output, 0);
      return output;
    },
    copyRegionInto(rect, target, targetOffset = 0) {
      copyBitmapRegion(this, rect, target, targetOffset);
      return target;
    },
    materialize() {
      return this.copyRegion({ x: 0, y: 0, width, height });
    },
    readPreview(maximumEdge = 1024) {
      if (disposed) throw new Error("Bitmap raster source is closed.");
      const scale = Math.min(1, maximumEdge / Math.max(width, height));
      const previewWidth = Math.max(1, Math.round(width * scale));
      const previewHeight = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = previewWidth;
      canvas.height = previewHeight;
      const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
      return {
        width: previewWidth,
        height: previewHeight,
        pixels: imageDataToLinear(context.getImageData(0, 0, previewWidth, previewHeight).data)
      };
    },
    clearCache() {
      cache.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      bitmap.close?.();
    }
  };
}

function buildBitmapTile(bitmap, level, tileX, tileY, gutter) {
  const factor = 2 ** level;
  const levelWidth = Math.ceil(bitmap.width / factor);
  const levelHeight = Math.ceil(bitmap.height / factor);
  const levelX = tileX * RASTER_TILE_SIZE;
  const levelY = tileY * RASTER_TILE_SIZE;
  const width = Math.min(RASTER_TILE_SIZE, levelWidth - levelX);
  const height = Math.min(RASTER_TILE_SIZE, levelHeight - levelY);
  if (width < 1 || height < 1) throw new Error("Bitmap tile is outside the image.");
  const stride = width + gutter * 2;
  const canvas = document.createElement("canvas");
  canvas.width = stride;
  canvas.height = height + gutter * 2;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  context.imageSmoothingEnabled = level > 0;
  context.imageSmoothingQuality = "high";
  const sourceX = levelX * factor;
  const sourceY = levelY * factor;
  const sourceWidth = Math.min(bitmap.width - sourceX, width * factor);
  const sourceHeight = Math.min(bitmap.height - sourceY, height * factor);
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, gutter, gutter, width, height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  duplicateGutter(imageData.data, canvas.width, canvas.height, gutter, width, height);
  return {
    level,
    tileX,
    tileY,
    gutter,
    width,
    height,
    stride,
    pixels: imageDataToLinear(imageData.data)
  };
}

function duplicateGutter(bytes, canvasWidth, canvasHeight, gutter, width, height) {
  if (!gutter) return;
  for (let y = 0; y < canvasHeight; y += 1) {
    const sourceY = clamp(y, gutter, gutter + height - 1);
    for (let x = 0; x < canvasWidth; x += 1) {
      if (x >= gutter && x < gutter + width && y >= gutter && y < gutter + height) continue;
      const sourceX = clamp(x, gutter, gutter + width - 1);
      const source = (sourceY * canvasWidth + sourceX) * 4;
      const target = (y * canvasWidth + x) * 4;
      bytes.copyWithin(target, source, source + 4);
    }
  }
}

function imageDataToLinear(bytes) {
  const output = new Float32Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 4) {
    output[index] = srgbToLinear(bytes[index] / 255);
    output[index + 1] = srgbToLinear(bytes[index + 1] / 255);
    output[index + 2] = srgbToLinear(bytes[index + 2] / 255);
    output[index + 3] = bytes[index + 3] / 255;
  }
  return output;
}

function copyBitmapRegion(source, rect, target, targetOffset) {
  const firstTileX = Math.floor(rect.x / RASTER_TILE_SIZE);
  const lastTileX = Math.floor((rect.x + rect.width - 1) / RASTER_TILE_SIZE);
  const firstTileY = Math.floor(rect.y / RASTER_TILE_SIZE);
  const lastTileY = Math.floor((rect.y + rect.height - 1) / RASTER_TILE_SIZE);
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const tile = source.getTile(0, tileX, tileY, 0);
      const tileLeft = tileX * RASTER_TILE_SIZE;
      const tileTop = tileY * RASTER_TILE_SIZE;
      const left = Math.max(rect.x, tileLeft);
      const top = Math.max(rect.y, tileTop);
      const right = Math.min(rect.x + rect.width, tileLeft + tile.width);
      const bottom = Math.min(rect.y + rect.height, tileTop + tile.height);
      for (let y = top; y < bottom; y += 1) {
        const sourceOffset = ((y - tileTop) * tile.stride + left - tileLeft) * 4;
        const targetRow = y - rect.y;
        const targetOffsetRow = targetOffset + (targetRow * rect.width + left - rect.x) * 4;
        target.set(tile.pixels.subarray(sourceOffset, sourceOffset + (right - left) * 4), targetOffsetRow);
      }
    }
  }
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function copyRegionInto(sourcePixels, sourceWidth, rect, target, targetOffset) {
  for (let row = 0; row < rect.height; row += 1) {
    const source = ((rect.y + row) * sourceWidth + rect.x) * 4;
    const targetStart = targetOffset + row * rect.width * 4;
    target.set(sourcePixels.subarray(source, source + rect.width * 4), targetStart);
  }
}

function buildTile(sourcePixels, sourceWidth, sourceHeight, level, tileX, tileY, gutter) {
  const factor = 2 ** level;
  const levelWidth = Math.ceil(sourceWidth / factor);
  const levelHeight = Math.ceil(sourceHeight / factor);
  const levelX = tileX * RASTER_TILE_SIZE;
  const levelY = tileY * RASTER_TILE_SIZE;
  const width = Math.min(RASTER_TILE_SIZE, levelWidth - levelX);
  const height = Math.min(RASTER_TILE_SIZE, levelHeight - levelY);
  const stride = width + gutter * 2;
  const pixels = new Float32Array(stride * (height + gutter * 2) * 4);

  for (let localY = -gutter; localY < height + gutter; localY += 1) {
    const sampleY = clamp(levelY + localY, 0, levelHeight - 1);
    const sourceTop = sampleY * factor;
    const sourceBottom = Math.min(sourceHeight, sourceTop + factor);
    for (let localX = -gutter; localX < width + gutter; localX += 1) {
      const sampleX = clamp(levelX + localX, 0, levelWidth - 1);
      const sourceLeft = sampleX * factor;
      const sourceRight = Math.min(sourceWidth, sourceLeft + factor);
      const target = ((localY + gutter) * stride + localX + gutter) * 4;
      averagePixel(sourcePixels, sourceWidth, sourceLeft, sourceTop, sourceRight, sourceBottom, pixels, target);
    }
  }
  return { level, tileX, tileY, gutter, width, height, stride, pixels };
}

function averagePixel(source, sourceWidth, left, top, right, bottom, target, targetOffset) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    let offset = (y * sourceWidth + left) * 4;
    for (let x = left; x < right; x += 1) {
      red += source[offset];
      green += source[offset + 1];
      blue += source[offset + 2];
      alpha += source[offset + 3];
      count += 1;
      offset += 4;
    }
  }
  const scale = count ? 1 / count : 0;
  target[targetOffset] = red * scale;
  target[targetOffset + 1] = green * scale;
  target[targetOffset + 2] = blue * scale;
  target[targetOffset + 3] = alpha * scale;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
