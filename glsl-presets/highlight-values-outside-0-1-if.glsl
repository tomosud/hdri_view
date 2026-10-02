// @name Highlight values outside 0-1 (if)
// @category Analysis and visualization
// @generator false
// @order 220

// Visualize RGB values outside the standard 0.0-1.0 range.
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
