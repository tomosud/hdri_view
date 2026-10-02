// @name Blur 3 tap (horizontal)
// @category Spatial filters
// @generator false
// @order 120

// Average the current pixel with its horizontal neighbors.
//
// texel contains the normalized size of one input pixel.
// Change the X offsets to widen or reshape the blur kernel.
vec2 texel = 1.0 / inputResolution;
vec4 left   = sampleInput(uv + vec2(-texel.x, 0.0));
vec4 center = sampleInput(uv);
vec4 right  = sampleInput(uv + vec2( texel.x, 0.0));

outputColor = (left + center + right) / 3.0;
