// @name Cosine stripes (generate)
// @category Generated images
// @generator true
// @order 280

// Generate smooth, rotatable cosine stripes.
//
// stripeCount controls spatial frequency.
// angleDegrees rotates the stripe direction.
const float tau = 6.28318530718;
const float stripeCount = 24.0;
const float angleDegrees = 20.0;

float angle = radians(angleDegrees);
vec2 direction = vec2(cos(angle), sin(angle));
vec2 position = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
float stripes = 0.5 + 0.5 * cos(dot(position, direction) * stripeCount * tau);

outputColor = vec4(vec3(stripes), 1.0);
