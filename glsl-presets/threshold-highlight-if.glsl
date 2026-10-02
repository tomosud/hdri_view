// @name Threshold highlight (if)
// @category Analysis and visualization
// @generator false
// @order 210

// Replace pixels at or above a luminance threshold with red.
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
