// GLSL フラグメントシェーダで画像を加工／生成するためのランタイム。
//
// Float32Array(linear RGBA) を入れて Float32Array(linear RGBA) を返す純関数として作ってあるので、
// 画像レコードの現在表示へそのまま接続できる（Picker / Selection / HDR・EXR 保存がそのまま効く）。
// three.js は使わず、WebGL2 を直接叩く。

// ユーザーが書くのは mainImage() の中身だけ。outputColor は out 引数なので
// 「代入する」1通りしかなく、uv / inputColor も引数なので普通のスコープ規則になる。
// アプリ側で変数を後から差し込む細工はしない。
const PRELUDE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D inputTexture;
uniform vec2 resolution;
uniform vec2 inputResolution;
uniform float time;

in vec2 vUv;
out vec4 hdriViewerFragColor;

float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 srgbToLinear(vec3 color) {
  vec3 safe = max(color, vec3(0.0));
  return mix(safe / 12.92, pow((safe + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), safe));
}

vec3 linearToSrgb(vec3 color) {
  vec3 safe = max(color, vec3(0.0));
  return mix(safe * 12.92, 1.055 * pow(safe, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), safe));
}

vec2 texelSize() {
  return 1.0 / resolution;
}

vec4 sampleInput(vec2 position) {
  return texture(inputTexture, clamp(position, vec2(0.0), vec2(1.0)));
}

void mainImage(out vec4 outputColor, in vec2 uv, in vec4 inputColor) {
`;

const EPILOGUE = `
}

void main() {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, vUv, texture(inputTexture, vUv));
  hdriViewerFragColor = color;
}
`;

// vUv(0,0) を画像の左上に合わせる。
// gl_Position.y = -1 がフレームバッファの y = 0 で、readPixels は y = 0 から返すので、
// そこを画像の 1 行目（＝アップロード時の 1 行目）に対応させると往復で行順が一致する。
const VERTEX_SOURCE = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const PRELUDE_LINE_COUNT = PRELUDE.split("\n").length - 1;

export class GlslError extends Error {
  constructor(message, log = "") {
    super(message);
    this.name = "GlslError";
    this.log = log || message;
  }
}

export const GLSL_PRESETS = [
  {
    name: "Passthrough",
    generator: false,
    code: "outputColor = inputColor;\n"
  },
  {
    name: "Exposure +1 EV",
    generator: false,
    code: "outputColor = vec4(inputColor.rgb * 2.0, inputColor.a);\n"
  },
  {
    name: "Grayscale",
    generator: false,
    code: "outputColor = vec4(vec3(luminance(inputColor.rgb)), inputColor.a);\n"
  },
  {
    name: "Blur 3 tap (horizontal)",
    generator: false,
    code: `vec2 texel = 1.0 / resolution;
vec4 left   = texture(inputTexture, uv + vec2(-texel.x, 0.0));
vec4 center = texture(inputTexture, uv);
vec4 right  = texture(inputTexture, uv + vec2( texel.x, 0.0));
outputColor = (left + center + right) / 3.0;
`
  },
  {
    name: "Channel swap (BGRA)",
    generator: false,
    code: "outputColor = inputColor.bgra;\n"
  },
  {
    name: "Gradient (generate)",
    generator: true,
    code: "outputColor = vec4(uv.x, uv.y, 0.0, 1.0);\n"
  },
  {
    name: "Radial HDR light (generate)",
    generator: true,
    code: `vec2 centered = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
float radius = length(centered);
float intensity = 40.0 / (1.0 + radius * radius * 900.0);
outputColor = vec4(vec3(intensity), 1.0);
`
  }
];

export const DEFAULT_FILTER_CODE = GLSL_PRESETS[0].code;
export const DEFAULT_GENERATOR_CODE = GLSL_PRESETS[5].code;

// MAX_TEXTURE_SIZE だけを上限にすると、環境によっては数 GB の CPU/GPU メモリを
// 確保できてしまう。UI を止めないため、GLSL の入出力は 8 MP までという契約にする。
export const MAX_GLSL_PIXELS = 4096 * 2048;

/** ラッパを被せた完全なフラグメントシェーダを返す（テストから使えるように export する）。 */
export function assembleFragmentSource(userCode) {
  return `${PRELUDE}${userCode}${EPILOGUE}`;
}

/**
 * ドライバのコンパイルログの行番号はラッパぶんずれているので、ユーザーが書いた行番号に直す。
 * 例: "ERROR: 0:47: 'foo' : undeclared identifier" -> "ERROR: line 3: 'foo' : undeclared identifier"
 */
export function formatCompileLog(log) {
  return String(log || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line.replace(/^(ERROR|WARNING)\s*:\s*\d+\s*:\s*(\d+)\s*:/i, (match, level, lineNumber) => {
        const userLine = Number(lineNumber) - PRELUDE_LINE_COUNT;
        return userLine > 0 ? `${level}: line ${userLine}:` : `${level}:`;
      })
    )
    .join("\n");
}

let glCanvas = null;
let gl = null;
let floatBufferExtension = null;
let linearFilterExtension = null;
let cachedProgram = null;
let cachedProgramSource = "";
let blankTexture = null;
let cachedInputTexture = null;
let cachedInputKey = null;

function resetContext() {
  glCanvas = null;
  gl = null;
  floatBufferExtension = null;
  linearFilterExtension = null;
  cachedProgram = null;
  cachedProgramSource = "";
  blankTexture = null;
  cachedInputTexture = null;
  cachedInputKey = null;
}

function ensureContext() {
  if (gl && !gl.isContextLost()) {
    return gl;
  }
  resetContext();

  glCanvas = document.createElement("canvas");
  glCanvas.width = 1;
  glCanvas.height = 1;
  glCanvas.addEventListener("webglcontextlost", (event) => {
    // 無限ループを書かれてコンテキストが飛んだ場合など。次の実行で作り直す。
    event.preventDefault();
    resetContext();
  });

  gl = glCanvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false
  });

  if (gl) {
    // 拡張はコンテキストごとに有効化する必要がある。作り直した直後に必ず取り直す
    // （キャッシュした判定結果を使い回すと、ロスト後の新コンテキストで float FBO が作れなくなる）。
    floatBufferExtension = gl.getExtension("EXT_color_buffer_float");
    linearFilterExtension = gl.getExtension("OES_texture_float_linear");
  }
  return gl;
}

/** GLSL 機能が使えるか。使えない場合は理由付きで返す。 */
export function getGlslSupport() {
  const context = ensureContext();
  if (!context) {
    return { ok: false, reason: "WebGL2 is not available in this browser.", maxTextureSize: 0 };
  }
  // float の FBO に描けないと HDR の値域を保ったまま出力できない
  if (!floatBufferExtension) {
    return {
      ok: false,
      reason: "EXT_color_buffer_float is not available, so float output cannot be rendered.",
      maxTextureSize: 0
    };
  }
  return {
    ok: true,
    reason: "",
    // float テクスチャの線形補間は拡張が無いと NEAREST 止まり
    linearFilter: Boolean(linearFilterExtension),
    maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE)
  };
}

function compileShader(context, type, source) {
  const shader = context.createShader(type);
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    const log = context.getShaderInfoLog(shader) || "";
    context.deleteShader(shader);
    throw new GlslError("Shader compilation failed.", formatCompileLog(log));
  }
  return shader;
}

function getProgram(context, userCode) {
  const fragmentSource = assembleFragmentSource(userCode);
  if (cachedProgram && cachedProgramSource === fragmentSource) {
    return cachedProgram;
  }

  const vertexShader = compileShader(context, context.VERTEX_SHADER, VERTEX_SOURCE);
  let fragmentShader;
  try {
    fragmentShader = compileShader(context, context.FRAGMENT_SHADER, fragmentSource);
  } catch (error) {
    context.deleteShader(vertexShader);
    throw error;
  }

  const program = context.createProgram();
  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  context.deleteShader(vertexShader);
  context.deleteShader(fragmentShader);

  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    const log = context.getProgramInfoLog(program) || "";
    context.deleteProgram(program);
    throw new GlslError("Shader linking failed.", formatCompileLog(log));
  }

  if (cachedProgram) {
    context.deleteProgram(cachedProgram);
  }
  cachedProgram = program;
  cachedProgramSource = fragmentSource;
  return program;
}

function ensureBlankTexture(context) {
  if (blankTexture) {
    return blankTexture;
  }
  blankTexture = context.createTexture();
  context.bindTexture(context.TEXTURE_2D, blankTexture);
  context.texImage2D(
    context.TEXTURE_2D,
    0,
    context.RGBA32F,
    1,
    1,
    0,
    context.RGBA,
    context.FLOAT,
    new Float32Array([0, 0, 0, 1])
  );
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
  return blankTexture;
}

function createInputTexture(context, input, useLinearFilter) {
  const texture = context.createTexture();
  context.bindTexture(context.TEXTURE_2D, texture);
  context.pixelStorei(context.UNPACK_ALIGNMENT, 1);
  context.texImage2D(
    context.TEXTURE_2D,
    0,
    context.RGBA32F,
    input.width,
    input.height,
    0,
    context.RGBA,
    context.FLOAT,
    input.pixels
  );
  const filter = useLinearFilter ? context.LINEAR : context.NEAREST;
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, filter);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, filter);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
  return texture;
}

// 入力画像は編集中に変化しないので、キーが同じ間はアップロード済みのテクスチャを使い回す。
// 毎回作り直すと 2k 画像で数十 MB を打鍵のたびに転送することになり、GPU メモリが荒れる。
function getInputTexture(context, input, useLinearFilter) {
  if (!input) {
    return ensureBlankTexture(context);
  }
  const key = input.key != null ? `${input.key}:${input.width}x${input.height}` : null;
  if (cachedInputTexture && key !== null && cachedInputKey === key) {
    return cachedInputTexture;
  }
  if (cachedInputTexture) {
    context.deleteTexture(cachedInputTexture);
    cachedInputTexture = null;
    cachedInputKey = null;
  }
  const texture = createInputTexture(context, input, useLinearFilter);
  if (key !== null) {
    cachedInputTexture = texture;
    cachedInputKey = key;
  }
  return texture;
}

/**
 * シェーダを 1 回実行して linear RGBA の Float32Array を返す。
 *
 * @param {{ code: string, input: {pixels: Float32Array, width: number, height: number, key?: string|number}|null,
 *           width: number, height: number, time?: number }} options
 */
export function runGlslShader({ code, input, width, height, time = 0 }) {
  const info = getGlslSupport();
  if (!info.ok) {
    throw new GlslError(info.reason);
  }
  const context = ensureContext();
  if (!context) {
    throw new GlslError("WebGL2 context could not be created.");
  }

  const outputWidth = Math.floor(width);
  const outputHeight = Math.floor(height);
  if (!Number.isInteger(outputWidth) || !Number.isInteger(outputHeight) || outputWidth < 1 || outputHeight < 1) {
    throw new GlslError("Output size must be 1 x 1 or larger.");
  }
  if (outputWidth > info.maxTextureSize || outputHeight > info.maxTextureSize) {
    throw new GlslError(`Output size exceeds this GPU's texture limit (${info.maxTextureSize}).`);
  }
  if (outputWidth * outputHeight > MAX_GLSL_PIXELS) {
    throw new GlslError(
      `Output is limited to ${MAX_GLSL_PIXELS.toLocaleString("en-US")} pixels (for example 4096 x 2048).`
    );
  }
  if (input && (input.width > info.maxTextureSize || input.height > info.maxTextureSize)) {
    throw new GlslError(`Input image exceeds this GPU's texture limit (${info.maxTextureSize}).`);
  }
  if (input && input.width * input.height > MAX_GLSL_PIXELS) {
    throw new GlslError(
      `Input is limited to ${MAX_GLSL_PIXELS.toLocaleString("en-US")} pixels for GLSL processing.`
    );
  }

  const program = getProgram(context, code);

  let inputTexture = null;
  let outputTexture = null;
  let framebuffer = null;

  try {
    if (!input && cachedInputTexture) {
      context.deleteTexture(cachedInputTexture);
      cachedInputTexture = null;
      cachedInputKey = null;
    }
    inputTexture = input
      ? getInputTexture(context, input, Boolean(info.linearFilter))
      : ensureBlankTexture(context);

    outputTexture = context.createTexture();
    context.bindTexture(context.TEXTURE_2D, outputTexture);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA32F,
      outputWidth,
      outputHeight,
      0,
      context.RGBA,
      context.FLOAT,
      null
    );
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);

    framebuffer = context.createFramebuffer();
    context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
    context.framebufferTexture2D(
      context.FRAMEBUFFER,
      context.COLOR_ATTACHMENT0,
      context.TEXTURE_2D,
      outputTexture,
      0
    );
    if (context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE) {
      throw new GlslError("Could not create a float render target for the requested size.");
    }

    context.useProgram(program);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, inputTexture);
    context.uniform1i(context.getUniformLocation(program, "inputTexture"), 0);
    context.uniform2f(context.getUniformLocation(program, "resolution"), outputWidth, outputHeight);
    context.uniform2f(
      context.getUniformLocation(program, "inputResolution"),
      input ? input.width : 1,
      input ? input.height : 1
    );
    context.uniform1f(context.getUniformLocation(program, "time"), time);

    context.viewport(0, 0, outputWidth, outputHeight);
    context.disable(context.DEPTH_TEST);
    context.disable(context.BLEND);
    // 頂点属性は使わず gl_VertexID だけでフルスクリーン三角形を出す
    context.drawArrays(context.TRIANGLES, 0, 3);

    const pixels = new Float32Array(outputWidth * outputHeight * 4);
    context.readPixels(0, 0, outputWidth, outputHeight, context.RGBA, context.FLOAT, pixels);

    const error = context.getError();
    if (error !== context.NO_ERROR) {
      throw new GlslError(`WebGL reported error 0x${error.toString(16)} while reading the result back.`);
    }
    return pixels;
  } finally {
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    if (framebuffer) {
      context.deleteFramebuffer(framebuffer);
    }
    if (outputTexture) {
      context.deleteTexture(outputTexture);
    }
    if (inputTexture && inputTexture !== blankTexture && inputTexture !== cachedInputTexture) {
      context.deleteTexture(inputTexture);
    }
  }
}
