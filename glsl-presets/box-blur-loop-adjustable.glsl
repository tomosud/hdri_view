// @name Box blur (loop, adjustable)
// @category Spatial filters
// @generator false
// @order 130

// Average a square neighborhood using nested loops.
//
// Change radius to control the blur range.
// A radius of 1 samples 3x3 pixels; a radius of 2 samples 5x5.
// The cost grows as (radius * 2 + 1)^2, so 1-4 is recommended.
const int radius = 2;
vec2 texel = 1.0 / inputResolution;
vec4 sum = vec4(0.0);
float sampleCount = 0.0;

for (int y = -radius; y <= radius; y += 1) {
  for (int x = -radius; x <= radius; x += 1) {
    sum += sampleInput(uv + vec2(float(x), float(y)) * texel);
    sampleCount += 1.0;
  }
}

outputColor = sum / sampleCount;
