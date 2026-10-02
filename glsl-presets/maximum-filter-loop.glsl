// @name Maximum filter (loop)
// @category Spatial filters
// @generator false
// @order 150

// Replace RGB with the maximum value found in a square neighborhood.
//
// This expands bright regions and demonstrates max() inside nested loops.
// Alpha is preserved from the original center pixel.
const int radius = 2;
vec2 texel = 1.0 / inputResolution;
vec3 maximumRgb = inputColor.rgb;

for (int y = -radius; y <= radius; y += 1) {
  for (int x = -radius; x <= radius; x += 1) {
    vec3 sampleRgb = sampleInput(
      uv + vec2(float(x), float(y)) * texel
    ).rgb;
    maximumRgb = max(maximumRgb, sampleRgb);
  }
}

outputColor = vec4(maximumRgb, inputColor.a);
