// @name Exposure +1 EV
// @category Basic value operations
// @generator false
// @order 20

// Increase RGB exposure by one stop.
//
// One EV doubles the linear RGB values.
// Alpha is preserved without modification.
const float exposureMultiplier = 2.0;

outputColor = vec4(inputColor.rgb * exposureMultiplier, inputColor.a);
