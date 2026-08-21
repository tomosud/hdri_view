// HDRI Value Viewer の可搬クリップボード形式。
// text/plain として他アプリでも扱え、先頭マジックで本ツールは精密値を優先できる。

export const VALUE_MATRIX_MAGIC = "HDRI_VIEWER_VALUE_MATRIX 1";
export const MAX_VALUE_MATRIX_PIXELS = 1024 * 1024;

const CHANNEL_NAMES = ["R", "G", "B", "A"];

export function isValueMatrixText(text) {
  return String(text || "").replace(/^\uFEFF/, "").trimStart().startsWith(VALUE_MATRIX_MAGIC);
}

export function serializeValueMatrix({
  pixels,
  width,
  height,
  channels = [0, 1, 2, 3],
  encoding = "linear",
  alphaWeighted = false,
  name = "copied values",
  type = "clipboard-values/linear"
}) {
  validateDimensions(width, height);
  if (!(pixels instanceof Float32Array) || pixels.length !== width * height * 4) {
    throw new Error("Value Matrix pixel data does not match its dimensions.");
  }
  const normalizedChannels = normalizeChannels(channels);
  const metadata = {
    width,
    height,
    channels: normalizedChannels.map((channel) => CHANNEL_NAMES[channel]),
    encoding: normalizeEncoding(encoding),
    alphaWeighted: Boolean(alphaWeighted),
    name: String(name || "copied values").slice(0, 240),
    type: String(type || "clipboard-values/linear").slice(0, 120)
  };
  const lines = [VALUE_MATRIX_MAGIC, JSON.stringify(metadata), "data:"];
  const multiChannel = normalizedChannels.length > 1;
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const tuple = normalizedChannels.map((channel) =>
        formatEncodedValue(pixels[index + channel], channel, metadata.encoding)
      );
      row.push(multiChannel ? `(${tuple.join(",")})` : tuple[0]);
    }
    lines.push(`${row.join(",")},`);
  }
  return lines.join("\n");
}

export function serializeInternalValueReference({ token, width, height, name = "copied values" }) {
  validateDimensions(width, height, false);
  return [
    VALUE_MATRIX_MAGIC,
    JSON.stringify({
      width,
      height,
      channels: ["R", "G", "B", "A"],
      encoding: "linear",
      alphaWeighted: false,
      name: String(name || "copied values").slice(0, 240),
      storage: "internal",
      token: String(token || "")
    }),
    "data:"
  ].join("\n");
}

export function parseValueMatrix(text, options = {}) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!isValueMatrixText(source)) {
    return null;
  }
  const lines = source.split(/\r?\n/);
  if (lines[0].trim() !== VALUE_MATRIX_MAGIC || lines.length < 3) {
    throw new Error("Value Matrix header is incomplete.");
  }
  let metadata;
  try {
    metadata = JSON.parse(lines[1]);
  } catch {
    throw new Error("Value Matrix metadata is not valid JSON.");
  }
  validateDimensions(metadata.width, metadata.height, metadata.storage !== "internal");
  if (metadata.storage === "internal") {
    const resolved = options.resolveInternal?.(String(metadata.token || ""));
    if (!resolved) {
      const error = new Error("This Value Matrix refers to clipboard data that is no longer available in this page.");
      error.code = "VALUE_MATRIX_INTERNAL_UNAVAILABLE";
      throw error;
    }
    return resolved;
  }
  if (lines[2].trim().toLowerCase() !== "data:") {
    throw new Error("Value Matrix is missing its data section.");
  }
  const channels = normalizeChannels(metadata.channels);
  const rows = parseMatrixRows(lines.slice(3).join("\n"));
  return matrixRowsToImage(rows, {
    width: metadata.width,
    height: metadata.height,
    channels,
    encoding: normalizeEncoding(metadata.encoding),
    alphaWeighted: Boolean(metadata.alphaWeighted),
    name: metadata.name,
    type: metadata.type
  });
}

export function parseGenericValueMatrix(text) {
  const source = String(text || "").trim();
  if (!source || isValueMatrixText(source)) {
    return null;
  }
  let rows;
  try {
    rows = parseMatrixRows(source);
  } catch {
    return null;
  }
  if (rows.length === 0 || rows.some((row) => row.length !== rows[0].length)) {
    return null;
  }
  const width = rows[0].length;
  const height = rows.length;
  validateDimensions(width, height);
  const arity = rows[0][0].length;
  if (![1, 2, 3, 4].includes(arity) || rows.some((row) => row.some((cell) => cell.length !== arity))) {
    return null;
  }
  const channels = arity === 1 ? null : Array.from({ length: arity }, (_, index) => index);
  return matrixRowsToImage(rows, {
    width,
    height,
    channels,
    encoding: "linear",
    alphaWeighted: false,
    name: "pasted value matrix",
    type: "clipboard-values/linear"
  });
}

function parseMatrixRows(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.some((line) => line.includes("…"))) {
    throw new Error("Value Matrix has no complete data rows.");
  }
  return lines.map(splitMatrixRow);
}

function splitMatrixRow(line) {
  const cells = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= line.length; index += 1) {
    const character = line[index] || ",";
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) throw new Error("Value Matrix has unbalanced parentheses.");
    if (character === "," && depth === 0) {
      const cellText = line.slice(start, index).trim();
      if (cellText) cells.push(parseMatrixCell(cellText));
      start = index + 1;
    }
  }
  if (depth !== 0 || cells.length === 0) {
    throw new Error("Value Matrix row is malformed.");
  }
  return cells;
}

function parseMatrixCell(text) {
  const tuple = text.startsWith("(") && text.endsWith(")");
  const body = tuple ? text.slice(1, -1) : text;
  const values = body.split(",").map((value) => parseMatrixNumber(value.trim()));
  if (values.length < 1 || values.length > 4) {
    throw new Error("Value Matrix cells must contain one to four values.");
  }
  return values;
}

function parseMatrixNumber(text) {
  if (text === "NaN") return NaN;
  if (text === "Infinity" || text === "+Infinity") return Infinity;
  if (text === "-Infinity") return -Infinity;
  if (!text) throw new Error("Value Matrix contains an empty value.");
  const value = Number(text);
  if (Number.isNaN(value)) throw new Error(`Value Matrix contains a non-numeric value: ${text}`);
  return value;
}

function matrixRowsToImage(rows, metadata) {
  const { width, height } = metadata;
  if (rows.length !== height || rows.some((row) => row.length !== width)) {
    throw new Error(`Value Matrix data does not match ${width} x ${height}.`);
  }
  const channels = metadata.channels;
  const expectedArity = channels ? channels.length : 1;
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = rows[y][x];
      if (cell.length !== expectedArity) {
        throw new Error("Value Matrix cell channel count does not match its metadata.");
      }
      const index = (y * width + x) * 4;
      pixels[index + 3] = 1;
      if (!channels) {
        const value = decodeValue(cell[0], 0, metadata.encoding);
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
      } else {
        for (let valueIndex = 0; valueIndex < channels.length; valueIndex += 1) {
          const channel = channels[valueIndex];
          pixels[index + channel] = decodeValue(cell[valueIndex], channel, metadata.encoding);
        }
      }
      if (metadata.alphaWeighted && channels?.includes(3)) {
        const alpha = pixels[index + 3];
        for (const channel of [0, 1, 2]) {
          if (channels.includes(channel)) {
            pixels[index + channel] = alpha > 0 ? pixels[index + channel] / alpha : 0;
          }
        }
      }
    }
  }
  return {
    name: String(metadata.name || "pasted values").slice(0, 240),
    type: String(metadata.type || "clipboard-values/linear").slice(0, 120),
    sourceFormat: "values",
    width,
    height,
    pixels
  };
}

function normalizeChannels(channels) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 4) {
    throw new Error("Value Matrix channels are invalid.");
  }
  const normalized = channels.map((channel) => {
    if (Number.isInteger(channel) && channel >= 0 && channel <= 3) return channel;
    const index = CHANNEL_NAMES.indexOf(String(channel || "").toUpperCase());
    if (index === -1) throw new Error(`Unknown Value Matrix channel: ${channel}`);
    return index;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Value Matrix channels must be unique.");
  }
  return normalized;
}

function normalizeEncoding(encoding) {
  const normalized = String(encoding || "linear").toLowerCase();
  if (!["linear", "srgb", "srgb255", "code"].includes(normalized)) {
    throw new Error(`Unknown Value Matrix encoding: ${encoding}`);
  }
  return normalized;
}

function validateDimensions(width, height, enforceMatrixLimit = true) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Value Matrix dimensions must be positive integers.");
  }
  if (enforceMatrixLimit && width * height > MAX_VALUE_MATRIX_PIXELS) {
    throw new Error(`Value Matrix is limited to ${MAX_VALUE_MATRIX_PIXELS.toLocaleString("en-US")} pixels.`);
  }
}

function formatEncodedValue(value, channel, encoding) {
  let encoded = value;
  if (encoding === "srgb" && channel < 3) encoded = linearToSrgb(value);
  if (encoding === "srgb255") {
    encoded = (channel < 3 ? linearToSrgb(value) : value) * 255;
    return String(Math.round(clamp01(encoded / 255) * 255));
  }
  return formatNumber(encoded);
}

function decodeValue(value, channel, encoding) {
  if (encoding === "srgb255") {
    const normalized = value / 255;
    return channel < 3 ? srgbToLinear(normalized) : normalized;
  }
  if (encoding === "srgb" && channel < 3) return srgbToLinear(value);
  return value;
}

function srgbToLinear(value) {
  if (!Number.isFinite(value)) return value;
  if (value <= 0.04045) return value / 12.92;
  return Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value) {
  if (!Number.isFinite(value)) return value;
  if (value <= 0.0031308) return value * 12.92;
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  // Float32 を再度 Float32 に戻したとき同じビット値になる最短表現を使う。
  return value === 0 ? "0" : String(value);
}
