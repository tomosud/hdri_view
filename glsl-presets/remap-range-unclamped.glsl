// @name Remap range (unclamped)
// @category Basic value operations
// @generator false
// @order 60

// Linearly remap one RGB value range into another.
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
