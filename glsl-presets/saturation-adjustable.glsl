// @name Saturation (adjustable)
// @category Channels and color
// @generator false
// @order 200

// Adjust color saturation in linear RGB.
//
// saturation = 0.0 produces grayscale.
// saturation = 1.0 preserves the original color.
// saturation > 1.0 exaggerates color differences.
// The result is not clamped, so negative and HDR values are preserved.
const float saturation = 1.5;

float gray = luminance(inputColor.rgb);
vec3 adjusted = mix(vec3(gray), inputColor.rgb, saturation);
outputColor = vec4(adjusted, inputColor.a);
