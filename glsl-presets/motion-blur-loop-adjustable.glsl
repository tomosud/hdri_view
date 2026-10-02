// @name Motion blur (loop, adjustable)
// @category Spatial filters
// @generator false
// @order 140

// Average samples along a line to create directional motion blur.
//
// sampleCount must remain a compile-time integer of at least 2.
// distancePixels controls the total blur length in input pixels.
// angleDegrees controls the direction: 0 is horizontal, 90 is vertical.
const int sampleCount = 9;
const float distancePixels = 24.0;
const float angleDegrees = 20.0;

float angle = radians(angleDegrees);
vec2 direction = vec2(cos(angle), sin(angle)) / inputResolution;
vec4 sum = vec4(0.0);

for (int index = 0; index < sampleCount; index += 1) {
  float position = float(index) / float(sampleCount - 1) - 0.5;
  sum += sampleInput(uv + direction * position * distancePixels);
}

outputColor = sum / float(sampleCount);
