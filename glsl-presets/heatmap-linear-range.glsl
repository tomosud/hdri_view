// @name Heatmap (linear range)
// @category Analysis and visualization
// @generator false
// @order 230

// Map linear luminance values to a blue-to-red heatmap.
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
