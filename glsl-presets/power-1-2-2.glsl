// @name Power 1 / 2.2
// @category Basic value operations
// @generator false
// @order 90

// Raise non-negative RGB values to the power of 1 / 2.2.
//
// This is a simple power curve, not the exact sRGB transfer function.
// Use linearToSrgb() when exact sRGB encoding is required.
const float exponent = 1.0 / 2.2;

vec3 powered = pow(max(inputColor.rgb, vec3(0.0)), vec3(exponent));
outputColor = vec4(powered, inputColor.a);
