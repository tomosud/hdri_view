// @name Checkerboard (generate)
// @category Generated images
// @generator true
// @order 290

// Generate a resolution-independent checkerboard.
//
// cellSizePixels controls the approximate checker size in output pixels.
// colorA and colorB can contain HDR values when desired.
const float cellSizePixels = 64.0;
const vec3 colorA = vec3(0.05);
const vec3 colorB = vec3(0.8);

vec2 cell = floor(uv * resolution / cellSizePixels);
float alternate = mod(cell.x + cell.y, 2.0);
vec3 color = mix(colorA, colorB, alternate);

outputColor = vec4(color, 1.0);
