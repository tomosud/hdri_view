// @name Multiply RGB by -1.0
// @category Basic value operations
// @generator false
// @order 30

// Multiply every RGB channel by an adjustable value.
//
// The default multiplier creates negative RGB values.
// Negative values may look black in a normal SDR view, but they remain
// available to Pickers and can be preserved by OpenEXR export.
// Alpha is preserved without modification.
const float multiplier = -1.0;

outputColor = vec4(inputColor.rgb * multiplier, inputColor.a);
