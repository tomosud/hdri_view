// @name Remap range (clamped)
// @category Basic value operations
// @generator false
// @order 70

// Linearly remap one RGB value range into another.
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
