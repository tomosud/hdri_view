// @name Passthrough
// @category Basic value operations
// @generator false
// @order 10
// @default filter

// Return the input pixel without modification.
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
