// @name Clamp RGB to 0-1
// @category Basic value operations
// @generator false
// @order 50

// Clamp RGB values to the standard 0.0-1.0 range.
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
