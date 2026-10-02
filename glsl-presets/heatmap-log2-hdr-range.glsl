// @name Heatmap (log2 HDR range)
// @category Analysis and visualization
// @generator false
// @order 240

// Display HDR luminance as a heatmap over an exposure-value range.
//
// referenceValue is the value treated as 0 EV.
// minimumEv and maximumEv define the visible logarithmic range.
// Keep maximumEv different from minimumEv to avoid division by zero.
// Non-positive luminance is mapped to the minimum color.
const float referenceValue = 1.0;
const float minimumEv = -8.0;
const float maximumEv = 8.0;

float value = max(luminance(inputColor.rgb), 1e-20);
float ev = log2(value / referenceValue);
float normalized = clamp(
  (ev - minimumEv) / (maximumEv - minimumEv),
  0.0,
  1.0
);

// This compact triangular palette moves through:
// blue -> cyan -> green -> yellow -> red.
vec3 heatColor = clamp(
  vec3(
    1.5 - abs(4.0 * normalized - 3.0),
    1.5 - abs(4.0 * normalized - 2.0),
    1.5 - abs(4.0 * normalized - 1.0)
  ),
  0.0,
  1.0
);

outputColor = vec4(heatColor, inputColor.a);
