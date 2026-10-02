// @name Mosaic (adjustable)
// @category Spatial filters
// @generator false
// @order 110

// Create a pixelated mosaic by sampling once per block.
//
// blockSize is measured in input pixels and must remain greater than zero.
// Larger values create larger mosaic tiles.
// sampleInput() clamps coordinates at the image edges.
const float blockSize = 16.0;

vec2 pixelPosition = uv * inputResolution;
vec2 blockOrigin = floor(pixelPosition / blockSize) * blockSize;
vec2 blockCenter = blockOrigin + vec2(blockSize * 0.5);
vec2 sampleUv = blockCenter / inputResolution;

outputColor = sampleInput(sampleUv);
