// @name Edge detection (Sobel)
// @category Spatial filters
// @generator false
// @order 160

// Detect luminance edges with a 3x3 Sobel operator.
//
// gx measures horizontal change and gy measures vertical change.
// The result is not clamped, so strong HDR edges can exceed 1.0.
vec2 texel = 1.0 / inputResolution;
float tl = luminance(sampleInput(uv + vec2(-texel.x, -texel.y)).rgb);
float tc = luminance(sampleInput(uv + vec2( 0.0,     -texel.y)).rgb);
float tr = luminance(sampleInput(uv + vec2( texel.x, -texel.y)).rgb);
float ml = luminance(sampleInput(uv + vec2(-texel.x,  0.0)).rgb);
float mr = luminance(sampleInput(uv + vec2( texel.x,  0.0)).rgb);
float bl = luminance(sampleInput(uv + vec2(-texel.x,  texel.y)).rgb);
float bc = luminance(sampleInput(uv + vec2( 0.0,      texel.y)).rgb);
float br = luminance(sampleInput(uv + vec2( texel.x,  texel.y)).rgb);

float gx = -tl + tr - 2.0 * ml + 2.0 * mr - bl + br;
float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
float edge = length(vec2(gx, gy));
outputColor = vec4(vec3(edge), inputColor.a);
