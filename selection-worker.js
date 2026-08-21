import { serializeValueMatrix } from "./clipboard-matrix.js?v=20260821-1";

self.addEventListener("message", (event) => {
  const {
    task = "details",
    jobId,
    width,
    height,
    valueMode,
    channels,
    alphaWeighted = false,
    absoluteNits = false,
    integerEncoding = null,
    previewRows,
    previewColumns
  } = event.data;
  const pixels = new Float32Array(event.data.pixels);

  // RGBA 表示のときは、見えている合成結果に合わせて RGB に alpha を掛けてから集計する。
  // ワーカ側でやることでメインスレッドのコピー処理を増やさずに済む。
  if (alphaWeighted) {
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      pixels[index] *= alpha;
      pixels[index + 1] *= alpha;
      pixels[index + 2] *= alpha;
    }
  }

  const basePixels = pixelsForValueEncoding(pixels, valueMode, absoluteNits, integerEncoding);
  const displayPixels = valueMode === "srgb" ? applySrgbEncoding(basePixels) : basePixels;

  if (task === "matrix") {
    const matrix = serializeValueMatrix({
      pixels: basePixels,
      width,
      height,
      channels,
      encoding: valueMode,
      alphaWeighted,
      name: "selection matrix",
      type: "clipboard-values/linear"
    });
    self.postMessage({ kind: "fullMatrix", jobId, matrix });
    return;
  }

  const stats = selectionStats(displayPixels, width, height);
  const pooled = selectionPooledGrid(displayPixels, width, height);
  const texture = selectionPeakTexture(displayPixels, width, height);
  self.postMessage(
    { kind: "stats", jobId, stats, pooled, texture },
    [pooled.values.buffer, texture.values.buffer]
  );
  const matrix = selectionMatrixValue(
    basePixels,
    width,
    height,
    valueMode,
    channels,
    previewRows,
    previewColumns,
    true
  );
  self.postMessage({ kind: "preview", jobId, matrix });
});

function selectionStats(pixels, width, height) {
  const min = [Infinity, Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0, 0];
  const finiteCount = [0, 0, 0, 0];
  let luminanceMin = Infinity;
  let luminanceMax = -Infinity;
  let luminanceSum = 0;
  let luminanceCount = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      const value = pixels[index + channel];
      if (!Number.isFinite(value)) {
        continue;
      }
      min[channel] = Math.min(min[channel], value);
      max[channel] = Math.max(max[channel], value);
      sum[channel] += value;
      finiteCount[channel] += 1;
    }
    const luminance = pixelLuminance(pixels, index);
    if (Number.isFinite(luminance)) {
      luminanceMin = Math.min(luminanceMin, luminance);
      luminanceMax = Math.max(luminanceMax, luminance);
      luminanceSum += luminance;
      luminanceCount += 1;
    }
  }

  for (let channel = 0; channel < 4; channel += 1) {
    if (finiteCount[channel] === 0) {
      min[channel] = 0;
      max[channel] = 0;
    }
  }
  if (luminanceCount === 0) {
    luminanceMin = 0;
    luminanceMax = 0;
  }

  return {
    count: width * height,
    min,
    max,
    average: sum.map((value, channel) => finiteCount[channel] ? value / finiteCount[channel] : 0),
    averageLuminance: luminanceCount ? luminanceSum / luminanceCount : 0,
    luminanceMin,
    luminanceMax
  };
}

// Box-averaged linear RGBA grid (up to maxCols x maxRows cells) used to render the
// selection graph without missing small bright/dark spots that point sampling would skip.
function selectionPooledGrid(pixels, width, height, maxCols = 160, maxRows = 160) {
  const cols = Math.max(1, Math.min(maxCols, width));
  const rows = Math.max(1, Math.min(maxRows, height));
  const sums = new Float64Array(cols * rows * 4);
  const counts = new Float64Array(cols * rows * 4);

  for (let y = 0; y < height; y += 1) {
    const rowIndex = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x += 1) {
      const colIndex = Math.min(cols - 1, Math.floor((x * cols) / width));
      const cellBase = (rowIndex * cols + colIndex) * 4;
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = pixels[index + channel];
        if (Number.isFinite(value)) {
          sums[cellBase + channel] += value;
          counts[cellBase + channel] += 1;
        }
      }
    }
  }

  const values = new Float32Array(cols * rows * 4);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = counts[i] ? sums[i] / counts[i] : 0;
  }

  return { cols, rows, values };
}

// Higher-resolution color data for the selection graph. When the source is
// reduced, keep channel/luminance peaks instead of averaging them away.
// 256 samples along each axis is above the graph's height mesh resolution while
// staying close to the panel's actual on-screen resolution.
function selectionPeakTexture(pixels, width, height, maxCols = 256, maxRows = 256) {
  const cols = Math.max(1, Math.min(maxCols, width));
  const rows = Math.max(1, Math.min(maxRows, height));
  const componentCount = 5; // R, G, B, A, luminance
  const values = new Float32Array(cols * rows * componentCount);
  values.fill(-Infinity);

  for (let y = 0; y < height; y += 1) {
    const rowIndex = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x += 1) {
      const colIndex = Math.min(cols - 1, Math.floor((x * cols) / width));
      const sourceIndex = (y * width + x) * 4;
      const targetIndex = (rowIndex * cols + colIndex) * componentCount;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = pixels[sourceIndex + channel];
        if (Number.isFinite(value)) {
          values[targetIndex + channel] = Math.max(values[targetIndex + channel], value);
        }
      }
      const luminance = pixelLuminance(pixels, sourceIndex);
      if (Number.isFinite(luminance)) {
        values[targetIndex + 4] = Math.max(values[targetIndex + 4], luminance);
      }
    }
  }

  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      values[index] = 0;
    }
  }
  return { cols, rows, componentCount, values, peakPooled: cols < width || rows < height };
}

function selectionMatrixValue(
  pixels,
  width,
  height,
  mode,
  channels,
  rowLimit = height,
  columnLimit = width,
  describePreview = false
) {
  const lines = [];
  const multiChannel = channels.length > 1;
  const visibleRows = Math.min(height, rowLimit);
  const visibleColumns = Math.min(width, columnLimit);
  for (let y = 0; y < visibleRows; y += 1) {
    const row = [];
    for (let x = 0; x < visibleColumns; x += 1) {
      const index = (y * width + x) * 4;
      const tuple = channels.map((channel) => formatPixelValue(pixels[index + channel], channel, mode));
      row.push(multiChannel ? `(${tuple.join(",")})` : tuple[0]);
    }
    if (visibleColumns < width) {
      row.push("…");
    }
    lines.push(`${row.join(",")},`);
  }
  if (describePreview && (visibleRows < height || visibleColumns < width)) {
    lines.push(
      `… Preview: first ${visibleColumns} x ${visibleRows} of ${width} x ${height}. Copy Matrix copies all values.`
    );
  }
  return lines.join("\n");
}

function formatPixelValue(value, channel, mode) {
  if (mode === "srgb" && channel < 3) {
    return formatNumber(linearToSrgb(value));
  }
  return formatNumber(value);
}

function pixelsForValueEncoding(pixels, mode, absoluteNits, integerEncoding) {
  if (integerEncoding) return integerPixelsForMode(pixels, mode, integerEncoding);
  if (!absoluteNits || mode !== "srgb") return pixels;
  const result = pixels.slice();
  for (let index = 0; index < result.length; index += 4) {
    const mapped = toneMapAbsoluteRgb(result[index], result[index + 1], result[index + 2]);
    result[index] = mapped[0];
    result[index + 1] = mapped[1];
    result[index + 2] = mapped[2];
  }
  return result;
}

function integerPixelsForMode(pixels, mode, encoding) {
  const result = pixels.slice();
  if (encoding.normalized) {
    if (mode !== "code") return result;
    const minimum = encoding.signed ? -(2 ** (encoding.bits - 1)) : 0;
    const maximum = encoding.signed ? (2 ** (encoding.bits - 1)) - 1 : (2 ** encoding.bits) - 1;
    const range = maximum - minimum;
    const codeValue = encoding.transfer === "linear"
      ? (value) => value
      : (value) => linearToSrgb(value);
    for (let index = 0; index < result.length; index += 4) {
      result[index] = Math.round(clamp01(codeValue(result[index])) * range + minimum);
      result[index + 1] = Math.round(clamp01(codeValue(result[index + 1])) * range + minimum);
      result[index + 2] = Math.round(clamp01(codeValue(result[index + 2])) * range + minimum);
      result[index + 3] = encoding.syntheticAlpha
        ? result[index + 3]
        : Math.round(clamp01(result[index + 3]) * ((2 ** encoding.bits) - 1));
    }
    return result;
  }
  const minimum = encoding.signed ? -(2 ** (encoding.bits - 1)) : 0;
  const maximum = encoding.signed ? (2 ** (encoding.bits - 1)) - 1 : (2 ** encoding.bits) - 1;
  const range = maximum - minimum || 1;
  const slope = Number(encoding.slope);
  const intercept = Number(encoding.intercept);
  for (let index = 0; index < result.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const code = slope ? Math.round((result[index + channel] - intercept) / slope) : result[index + channel];
      result[index + channel] = mode === "code" ? code : clamp01((code - minimum) / range);
    }
  }
  return result;
}

function applySrgbEncoding(pixels) {
  const result = pixels.slice();
  for (let index = 0; index < result.length; index += 4) {
    result[index] = linearToSrgb(result[index]);
    result[index + 1] = linearToSrgb(result[index + 1]);
    result[index + 2] = linearToSrgb(result[index + 2]);
  }
  return result;
}

function toneMapAbsoluteRgb(redNits, greenNits, blueNits) {
  const red = Number.isFinite(redNits) ? redNits : 0;
  const green = Number.isFinite(greenNits) ? greenNits : 0;
  const blue = Number.isFinite(blueNits) ? blueNits : 0;
  const luminance = Math.max(0, 0.2126 * red + 0.7152 * green + 0.0722 * blue);
  if (luminance <= 1e-9) return [0, 0, 0];
  const mappedLuminance = acesToneMap(luminance / 100);
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

function pixelLuminance(pixels, index) {
  return 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
}

function linearToSrgb(value) {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
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
