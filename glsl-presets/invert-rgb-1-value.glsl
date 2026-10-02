// @name Invert RGB (1 - value)
// @category Basic value operations
// @generator false
// @order 40

// Invert RGB around 1.0.
//
// This is different from multiplying by -1.0:
//   0.0 becomes 1.0
//   0.25 becomes 0.75
//   1.0 becomes 0.0
// Values outside 0.0-1.0 remain outside that range after inversion.
outputColor = vec4(vec3(1.0) - inputColor.rgb, inputColor.a);
