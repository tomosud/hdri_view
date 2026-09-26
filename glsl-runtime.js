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
    category: "Basic value operations",
    generator: false,
    code: `// Return the input pixel without modification.
outputColor = inputColor;

// ---------------------------------------------------------------------------
// QUICK REFERENCE
// ---------------------------------------------------------------------------
//
// mainImage arguments
//
//   vec4 outputColor
//     The output RGBA value. Assign the final pixel value to this variable.
//     Do not redeclare it. Values are floating point and are not clamped.
//
//   vec2 uv
//     Normalized output coordinates. The top-left is vec2(0.0, 0.0)
//     and the bottom-right is vec2(1.0, 1.0).
//
//   vec4 inputColor
//     The linear RGBA value sampled from the input image at uv.
//     Components can be accessed as .r .g .b .a or .x .y .z .w.
//
// Available uniforms
//
//   sampler2D inputTexture
//     The complete input image. Use texture(inputTexture, position) or the
//     safer sampleInput(position) helper to sample another location.
//
//   vec2 resolution
//     Output size in pixels: vec2(outputWidth, outputHeight).
//
//   vec2 inputResolution
//     Input texture size in pixels: vec2(inputWidth, inputHeight).
//     Use 1.0 / inputResolution for one input-pixel sampling offsets.
//
//   float time
//     Time value supplied by the caller. It is currently 0.0 in the editor,
//     but it can be used when the caller provides animation time.
//
// Available helper functions
//
//   float luminance(vec3 color)
//     Returns Rec.709 luminance from linear RGB.
//
//   vec3 srgbToLinear(vec3 color)
//     Converts non-negative sRGB values to linear RGB.
//
//   vec3 linearToSrgb(vec3 color)
//     Converts non-negative linear RGB values to sRGB.
//
//   vec2 texelSize()
//     Returns 1.0 / resolution: the normalized size of one OUTPUT pixel.
//
//   vec4 sampleInput(vec2 position)
//     Samples inputTexture and clamps the coordinates to the image edges.
//
// Common GLSL ES 3.00 types
//
//   float        One floating-point value: float value = 0.5;
//   int          One integer value:        int count = 4;
//   bool         true or false:            bool enabled = true;
//   vec2         Two floats:               vec2 offset = vec2(1.0, 0.0);
//   vec3         Three floats / RGB:       vec3 color = vec3(1.0, 0.0, 0.0);
//   vec4         Four floats / RGBA:       vec4 color = vec4(rgb, alpha);
//   mat3 / mat4  3x3 or 4x4 matrices.
//   sampler2D    A two-dimensional texture.
//
// Useful built-in functions include:
//   min, max, clamp, mix, step, smoothstep, abs, floor, ceil, fract,
//   pow, exp, log, log2, sqrt, sin, cos, length, normalize, dot, and cross.
//
// Swizzle examples
//
//   inputColor.rgb    // Read RGB as vec3.
//   inputColor.bgr    // Read RGB with red and blue swapped.
//   inputColor.rrr    // Repeat red as grayscale RGB.
//   inputColor.rgba   // Read all four channels.
//
// Example: sample one input pixel to the right
//
//   vec2 inputTexel = 1.0 / inputResolution;
//   outputColor = sampleInput(uv + vec2(inputTexel.x, 0.0));
//
// Example: clamp RGB while preserving alpha
//
//   vec3 rgb = clamp(inputColor.rgb, 0.0, 1.0);
//   outputColor = vec4(rgb, inputColor.a);
//
// Example: remap RGB from 0.0-1.0 to 2.0-3.0
//
//   vec3 normalized = (inputColor.rgb - 0.0) / (1.0 - 0.0);
//   vec3 remapped = mix(vec3(2.0), vec3(3.0), normalized);
//   outputColor = vec4(remapped, inputColor.a);
//
// Example: use a conditional
//
//   if (luminance(inputColor.rgb) > 1.0) {
//     outputColor = vec4(1.0, 0.0, 0.0, inputColor.a);
//   } else {
//     outputColor = inputColor;
//   }
`
  },
  {
    name: "Exposure +1 EV",
    category: "Basic value operations",
    generator: false,
    code: `// Increase RGB exposure by one stop.
//
// One EV doubles the linear RGB values.
// Alpha is preserved without modification.
const float exposureMultiplier = 2.0;

outputColor = vec4(inputColor.rgb * exposureMultiplier, inputColor.a);
`
  },
  {
    name: "Multiply RGB by -1.0",
    category: "Basic value operations",
    generator: false,
    code: `// Multiply every RGB channel by an adjustable value.
//
// The default multiplier creates negative RGB values.
// Negative values may look black in a normal SDR view, but they remain
// available to Pickers and can be preserved by OpenEXR export.
// Alpha is preserved without modification.
const float multiplier = -1.0;

outputColor = vec4(inputColor.rgb * multiplier, inputColor.a);
`
  },
  {
    name: "Invert RGB (1 - value)",
    category: "Basic value operations",
    generator: false,
    code: `// Invert RGB around 1.0.
//
// This is different from multiplying by -1.0:
//   0.0 becomes 1.0
//   0.25 becomes 0.75
//   1.0 becomes 0.0
// Values outside 0.0-1.0 remain outside that range after inversion.
outputColor = vec4(vec3(1.0) - inputColor.rgb, inputColor.a);
`
  },
  {
    name: "Clamp RGB to 0-1",
    category: "Basic value operations",
    generator: false,
    code: `// Clamp RGB values to the standard 0.0-1.0 range.
//
// Values below 0.0 become 0.0.
// Values above 1.0 become 1.0.
// Alpha is preserved without modification.
//
// Change minimumValue and maximumValue to use a custom range.
const float minimumValue = 0.0;
const float maximumValue = 1.0;

vec3 clampedRgb = clamp(inputColor.rgb, minimumValue, maximumValue);
outputColor = vec4(clampedRgb, inputColor.a);
`
  },
  {
    name: "Remap range (unclamped)",
    category: "Basic value operations",
    generator: false,
    code: `// Linearly remap one RGB value range into another.
//
// With the defaults:
//   input 0.0 becomes output 2.0
//   input 0.5 becomes output 2.5
//   input 1.0 becomes output 3.0
//
// Values outside the input range are extrapolated instead of clamped.
// Keep inputMaximum different from inputMinimum to avoid division by zero.
const float inputMinimum = 0.0;
const float inputMaximum = 1.0;
const float outputMinimum = 2.0;
const float outputMaximum = 3.0;

vec3 normalized = (inputColor.rgb - inputMinimum)
                / (inputMaximum - inputMinimum);
vec3 remapped = mix(vec3(outputMinimum), vec3(outputMaximum), normalized);

outputColor = vec4(remapped, inputColor.a);
`
  },
  {
    name: "Remap range (clamped)",
    category: "Basic value operations",
    generator: false,
    code: `// Linearly remap one RGB value range into another.
//
// Unlike the unclamped version, values outside the input range are
// limited to outputMinimum or outputMaximum.
// Keep inputMaximum different from inputMinimum to avoid division by zero.
const float inputMinimum = 0.0;
const float inputMaximum = 1.0;
const float outputMinimum = 2.0;
const float outputMaximum = 3.0;

vec3 normalized = (inputColor.rgb - inputMinimum)
                / (inputMaximum - inputMinimum);
normalized = clamp(normalized, 0.0, 1.0);

vec3 remapped = mix(vec3(outputMinimum), vec3(outputMaximum), normalized);
outputColor = vec4(remapped, inputColor.a);
`
  },
  {
    name: "Power 2.2",
    category: "Basic value operations",
    generator: false,
    code: `// Raise non-negative RGB values to the power of 2.2.
//
// pow() is undefined for negative bases with a fractional exponent,
// so RGB is limited to zero or greater before applying the power.
// Values above 1.0 are preserved and may grow significantly.
const float exponent = 2.2;

vec3 powered = pow(max(inputColor.rgb, vec3(0.0)), vec3(exponent));
outputColor = vec4(powered, inputColor.a);
`
  },
  {
    name: "Power 1 / 2.2",
    category: "Basic value operations",
    generator: false,
    code: `// Raise non-negative RGB values to the power of 1 / 2.2.
//
// This is a simple power curve, not the exact sRGB transfer function.
// Use linearToSrgb() when exact sRGB encoding is required.
const float exponent = 1.0 / 2.2;

vec3 powered = pow(max(inputColor.rgb, vec3(0.0)), vec3(exponent));
outputColor = vec4(powered, inputColor.a);
`
  },
  {
    name: "Grayscale",
    category: "Channels and color",
    generator: false,
    code: `// Convert linear RGB to Rec.709 luminance.
//
// The luminance() helper uses weights 0.2126, 0.7152, and 0.0722.
// Alpha is preserved without modification.
float gray = luminance(inputColor.rgb);
outputColor = vec4(vec3(gray), inputColor.a);
`
  },
  {
    name: "Mosaic (adjustable)",
    category: "Spatial filters",
    generator: false,
    code: `// Create a pixelated mosaic by sampling once per block.
//
// blockSize is measured in input pixels and must remain greater than zero.
// Larger values create larger mosaic tiles.
// sampleInput() clamps coordinates at the image edges.
const float blockSize = 16.0;

vec2 pixelPosition = uv * inputResolution;
vec2 blockOrigin = floor(pixelPosition / blockSize) * blockSize;
vec2 blockCenter = blockOrigin + vec2(blockSize * 0.5);
vec2 sampleUv = blockCenter / inputResolution;

outputColor = sampleInput(sampleUv);
`
  },
  {
    name: "Blur 3 tap (horizontal)",
    category: "Spatial filters",
    generator: false,
    code: `// Average the current pixel with its horizontal neighbors.
//
// texel contains the normalized size of one input pixel.
// Change the X offsets to widen or reshape the blur kernel.
vec2 texel = 1.0 / inputResolution;
vec4 left   = sampleInput(uv + vec2(-texel.x, 0.0));
vec4 center = sampleInput(uv);
vec4 right  = sampleInput(uv + vec2( texel.x, 0.0));

outputColor = (left + center + right) / 3.0;
`
  },
  {
    name: "Box blur (loop, adjustable)",
    category: "Spatial filters",
    generator: false,
    code: `// Average a square neighborhood using nested loops.
//
// Change radius to control the blur range.
// A radius of 1 samples 3x3 pixels; a radius of 2 samples 5x5.
// The cost grows as (radius * 2 + 1)^2, so 1-4 is recommended.
const int radius = 2;
vec2 texel = 1.0 / inputResolution;
vec4 sum = vec4(0.0);
float sampleCount = 0.0;

for (int y = -radius; y <= radius; y += 1) {
  for (int x = -radius; x <= radius; x += 1) {
    sum += sampleInput(uv + vec2(float(x), float(y)) * texel);
    sampleCount += 1.0;
  }
}

outputColor = sum / sampleCount;
`
  },
  {
    name: "Motion blur (loop, adjustable)",
    category: "Spatial filters",
    generator: false,
    code: `// Average samples along a line to create directional motion blur.
//
// sampleCount must remain a compile-time integer of at least 2.
// distancePixels controls the total blur length in input pixels.
// angleDegrees controls the direction: 0 is horizontal, 90 is vertical.
const int sampleCount = 9;
const float distancePixels = 24.0;
const float angleDegrees = 20.0;

float angle = radians(angleDegrees);
vec2 direction = vec2(cos(angle), sin(angle)) / inputResolution;
vec4 sum = vec4(0.0);

for (int index = 0; index < sampleCount; index += 1) {
  float position = float(index) / float(sampleCount - 1) - 0.5;
  sum += sampleInput(uv + direction * position * distancePixels);
}

outputColor = sum / float(sampleCount);
`
  },
  {
    name: "Maximum filter (loop)",
    category: "Spatial filters",
    generator: false,
    code: `// Replace RGB with the maximum value found in a square neighborhood.
//
// This expands bright regions and demonstrates max() inside nested loops.
// Alpha is preserved from the original center pixel.
const int radius = 2;
vec2 texel = 1.0 / inputResolution;
vec3 maximumRgb = inputColor.rgb;

for (int y = -radius; y <= radius; y += 1) {
  for (int x = -radius; x <= radius; x += 1) {
    vec3 sampleRgb = sampleInput(
      uv + vec2(float(x), float(y)) * texel
    ).rgb;
    maximumRgb = max(maximumRgb, sampleRgb);
  }
}

outputColor = vec4(maximumRgb, inputColor.a);
`
  },
  {
    name: "Edge detection (Sobel)",
    category: "Spatial filters",
    generator: false,
    code: `// Detect luminance edges with a 3x3 Sobel operator.
//
// gx measures horizontal change and gy measures vertical change.
// The result is not clamped, so strong HDR edges can exceed 1.0.
vec2 texel = 1.0 / inputResolution;
float tl = luminance(sampleInput(uv + vec2(-texel.x, -texel.y)).rgb);
float tc = luminance(sampleInput(uv + vec2( 0.0,     -texel.y)).rgb);
float tr = luminance(sampleInput(uv + vec2( texel.x, -texel.y)).rgb);
float ml = luminance(sampleInput(uv + vec2(-texel.x,  0.0)).rgb);
float mr = luminance(sampleInput(uv + vec2( texel.x,  0.0)).rgb);
float bl = luminance(sampleInput(uv + vec2(-texel.x,  texel.y)).rgb);
float bc = luminance(sampleInput(uv + vec2( 0.0,      texel.y)).rgb);
float br = luminance(sampleInput(uv + vec2( texel.x,  texel.y)).rgb);

float gx = -tl + tr - 2.0 * ml + 2.0 * mr - bl + br;
float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
float edge = length(vec2(gx, gy));
outputColor = vec4(vec3(edge), inputColor.a);
`
  },
  {
    name: "Swap red and blue (swizzle)",
    category: "Channels and color",
    generator: false,
    code: `// Swap the red and blue channels with a GLSL swizzle.
//
// inputColor.bgra means B becomes R, G stays G, R becomes B,
// and A stays A. Try other swizzles such as grba or rrrr.
outputColor = inputColor.bgra;
`
  },
  {
    name: "RGB to YUV (Rec.709)",
    category: "Channels and color",
    generator: false,
    code: `// Convert linear RGB to full-range Rec.709 YUV values.
//
// Output channels contain:
//   R = Y (luminance)
//   G = U (blue difference, signed)
//   B = V (red difference, signed)
//
// U and V can be negative. They are intentionally not shifted by 0.5,
// so OpenEXR export preserves the mathematical values.
float y = luminance(inputColor.rgb);
float u = (inputColor.b - y) / 1.8556;
float v = (inputColor.r - y) / 1.5748;

outputColor = vec4(y, u, v, inputColor.a);
`
  },
  {
    name: "YUV to RGB (Rec.709)",
    category: "Channels and color",
    generator: false,
    code: `// Convert full-range Rec.709 YUV back to linear RGB.
//
// Expected input channel layout:
//   R = Y (luminance)
//   G = U (blue difference, signed)
//   B = V (red difference, signed)
//
// This is the inverse of the RGB to YUV preset.
float y = inputColor.r;
float u = inputColor.g;
float v = inputColor.b;

float red = y + 1.5748 * v;
float blue = y + 1.8556 * u;
float green = (y - 0.2126 * red - 0.0722 * blue) / 0.7152;

outputColor = vec4(red, green, blue, inputColor.a);
`
  },
  {
    name: "Saturation (adjustable)",
    category: "Channels and color",
    generator: false,
    code: `// Adjust color saturation in linear RGB.
//
// saturation = 0.0 produces grayscale.
// saturation = 1.0 preserves the original color.
// saturation > 1.0 exaggerates color differences.
// The result is not clamped, so negative and HDR values are preserved.
const float saturation = 1.5;

float gray = luminance(inputColor.rgb);
vec3 adjusted = mix(vec3(gray), inputColor.rgb, saturation);
outputColor = vec4(adjusted, inputColor.a);
`
  },
  {
    name: "Threshold highlight (if)",
    category: "Analysis and visualization",
    generator: false,
    code: `// Replace pixels at or above a luminance threshold with red.
//
// Change threshold to inspect a different value boundary.
// Set blendAmount below 1.0 to mix the warning color with the input.
const float threshold = 1.0;
const float blendAmount = 1.0;

float value = luminance(inputColor.rgb);
vec3 result = inputColor.rgb;

if (value >= threshold) {
  result = mix(inputColor.rgb, vec3(1.0, 0.0, 0.0), blendAmount);
}

outputColor = vec4(result, inputColor.a);
`
  },
  {
    name: "Highlight values outside 0-1 (if)",
    category: "Analysis and visualization",
    generator: false,
    code: `// Visualize RGB values outside the standard 0.0-1.0 range.
//
// Blue marks pixels containing at least one negative RGB channel.
// Red marks pixels containing at least one RGB channel above 1.0.
// Magenta marks pixels that contain both conditions.
bool belowRange = any(lessThan(inputColor.rgb, vec3(0.0)));
bool aboveRange = any(greaterThan(inputColor.rgb, vec3(1.0)));

vec3 result = inputColor.rgb;
if (belowRange && aboveRange) {
  result = vec3(1.0, 0.0, 1.0);
} else if (belowRange) {
  result = vec3(0.0, 0.35, 1.0);
} else if (aboveRange) {
  result = vec3(1.0, 0.0, 0.0);
}

outputColor = vec4(result, inputColor.a);
`
  },
  {
    name: "Heatmap (linear range)",
    category: "Analysis and visualization",
    generator: false,
    code: `// Map linear luminance values to a blue-to-red heatmap.
//
// minimumValue maps to blue and maximumValue maps to red.
// Keep maximumValue different from minimumValue to avoid division by zero.
// Values outside the selected range are clamped to the endpoint colors.
// Replace luminance(inputColor.rgb) with inputColor.r to inspect red only.
const float minimumValue = 0.0;
const float maximumValue = 1.0;

float value = luminance(inputColor.rgb);
float normalized = clamp(
  (value - minimumValue) / (maximumValue - minimumValue),
  0.0,
  1.0
);

vec3 heatColor;
if (normalized < 0.25) {
  heatColor = mix(
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 1.0, 1.0),
    normalized * 4.0
  );
} else if (normalized < 0.5) {
  heatColor = mix(
    vec3(0.0, 1.0, 1.0),
    vec3(0.0, 1.0, 0.0),
    (normalized - 0.25) * 4.0
  );
} else if (normalized < 0.75) {
  heatColor = mix(
    vec3(0.0, 1.0, 0.0),
    vec3(1.0, 1.0, 0.0),
    (normalized - 0.5) * 4.0
  );
} else {
  heatColor = mix(
    vec3(1.0, 1.0, 0.0),
    vec3(1.0, 0.0, 0.0),
    (normalized - 0.75) * 4.0
  );
}

outputColor = vec4(heatColor, inputColor.a);
`
  },
  {
    name: "Heatmap (log2 HDR range)",
    category: "Analysis and visualization",
    generator: false,
    code: `// Display HDR luminance as a heatmap over an exposure-value range.
//
// referenceValue is the value treated as 0 EV.
// minimumEv and maximumEv define the visible logarithmic range.
// Keep maximumEv different from minimumEv to avoid division by zero.
// Non-positive luminance is mapped to the minimum color.
const float referenceValue = 1.0;
const float minimumEv = -8.0;
const float maximumEv = 8.0;

float value = max(luminance(inputColor.rgb), 1e-20);
float ev = log2(value / referenceValue);
float normalized = clamp(
  (ev - minimumEv) / (maximumEv - minimumEv),
  0.0,
  1.0
);

// This compact triangular palette moves through:
// blue -> cyan -> green -> yellow -> red.
vec3 heatColor = clamp(
  vec3(
    1.5 - abs(4.0 * normalized - 3.0),
    1.5 - abs(4.0 * normalized - 2.0),
    1.5 - abs(4.0 * normalized - 1.0)
  ),
  0.0,
  1.0
);

outputColor = vec4(heatColor, inputColor.a);
`
  },
  {
    name: "Gradient (generate)",
    category: "Generated images",
    generator: true,
    code: `// Generate a two-axis linear gradient without an input image.
//
// Red increases from left to right.
// Green increases from top to bottom.
// Blue remains zero and alpha remains one.
outputColor = vec4(uv.x, uv.y, 0.0, 1.0);
`
  },
  {
    name: "Radial HDR light (generate)",
    category: "Generated images",
    generator: true,
    code: `// Generate a bright radial HDR light.
//
// peakIntensity controls the center value and can exceed 1.0.
// falloff controls how quickly the light becomes darker.
// Aspect correction keeps the light circular on non-square outputs.
const float peakIntensity = 40.0;
const float falloff = 900.0;

vec2 centered = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
float radius = length(centered);
float intensity = peakIntensity / (1.0 + radius * radius * falloff);

outputColor = vec4(vec3(intensity), 1.0);
`
  },
  {
    name: "Cosine stripes (generate)",
    category: "Generated images",
    generator: true,
    code: `// Generate smooth, rotatable cosine stripes.
//
// stripeCount controls spatial frequency.
// angleDegrees rotates the stripe direction.
const float tau = 6.28318530718;
const float stripeCount = 24.0;
const float angleDegrees = 20.0;

float angle = radians(angleDegrees);
vec2 direction = vec2(cos(angle), sin(angle));
vec2 position = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
float stripes = 0.5 + 0.5 * cos(dot(position, direction) * stripeCount * tau);

outputColor = vec4(vec3(stripes), 1.0);
`
  },
  {
    name: "Checkerboard (generate)",
    category: "Generated images",
    generator: true,
    code: `// Generate a resolution-independent checkerboard.
//
// cellSizePixels controls the approximate checker size in output pixels.
// colorA and colorB can contain HDR values when desired.
const float cellSizePixels = 64.0;
const vec3 colorA = vec3(0.05);
const vec3 colorB = vec3(0.8);

vec2 cell = floor(uv * resolution / cellSizePixels);
float alternate = mod(cell.x + cell.y, 2.0);
vec3 color = mix(colorA, colorB, alternate);

outputColor = vec4(color, 1.0);
`
  }
];

export const DEFAULT_FILTER_CODE = GLSL_PRESETS[0].code;
export const DEFAULT_GENERATOR_CODE = GLSL_PRESETS.find((preset) => preset.generator).code;

// MAX_TEXTURE_SIZE だけを上限にすると、環境によっては数 GB の CPU/GPU メモリを
// 確保できてしまう。16 MP 級のスキャンを扱いつつ、無制限な確保は防ぐ。
export const MAX_GLSL_PIXELS = 4096 * 4096;
export const MAX_GLSL_EDGE = 4096;

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
  if (outputWidth > MAX_GLSL_EDGE || outputHeight > MAX_GLSL_EDGE) {
    throw new GlslError(`Output width and height are limited to ${MAX_GLSL_EDGE}px.`);
  }
  if (outputWidth * outputHeight > MAX_GLSL_PIXELS) {
    throw new GlslError(
      `Output is limited to ${MAX_GLSL_PIXELS.toLocaleString("en-US")} pixels (for example 4096 x 4096).`
    );
  }
  if (input && (input.width > info.maxTextureSize || input.height > info.maxTextureSize)) {
    throw new GlslError(`Input image exceeds this GPU's texture limit (${info.maxTextureSize}).`);
  }
  if (input && (input.width > MAX_GLSL_EDGE || input.height > MAX_GLSL_EDGE)) {
    throw new GlslError(`Input width and height are limited to ${MAX_GLSL_EDGE}px for GLSL processing.`);
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
