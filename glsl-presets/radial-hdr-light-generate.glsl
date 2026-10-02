// @name Radial HDR light (generate)
// @category Generated images
// @generator true
// @order 270

// Generate a bright radial HDR light.
//
// peakIntensity controls the center value and can exceed 1.0.
// falloff controls how quickly the light becomes darker.
// Aspect correction keeps the light circular on non-square outputs.
const float peakIntensity = 40.0;
const float falloff = 900.0;

vec2 centered = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
float radius = length(centered);
float intensity = peakIntensity / (1.0 + radius * radius * falloff);

outputColor = vec4(vec3(intensity), 1.0);
