self.addEventListener("message", (event) => {
  const {
    task = "details",
    jobId,
    width,
    height,
    valueMode,
    channels,
    previewRows,
    previewColumns
  } = event.data;
  const pixels = new Float32Array(event.data.pixels);
  if (task === "matrix") {
    const matrix = selectionMatrixValue(pixels, width, height, valueMode, channels);
    self.postMessage({ kind: "fullMatrix", jobId, matrix });
    return;
  }

  const stats = selectionStats(pixels, width, height);
  self.postMessage({ kind: "stats", jobId, stats });
  const matrix = selectionMatrixValue(
    pixels,
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
  if (mode === "srgb255") {
    const converted = channel < 3 ? linearToSrgb(value) : value;
    return Math.round(clamp01(converted) * 255);
  }
  if (mode === "srgb" && channel < 3) {
    return formatNumber(linearToSrgb(value));
  }
  return formatNumber(value);
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