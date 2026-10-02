// @name Power 2.2
// @category Basic value operations
// @generator false
// @order 80

// Raise non-negative RGB values to the power of 2.2.
//
// pow() is undefined for negative bases with a fractional exponent,
// so RGB is limited to zero or greater before applying the power.
// Values above 1.0 are preserved and may grow significantly.
const float exponent = 2.2;

vec3 powered = pow(max(inputColor.rgb, vec3(0.0)), vec3(exponent));
outputColor = vec4(powered, inputColor.a);
