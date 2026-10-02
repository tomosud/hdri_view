// @name Grayscale
// @category Channels and color
// @generator false
// @order 100

// Convert linear RGB to Rec.709 luminance.
//
// The luminance() helper uses weights 0.2126, 0.7152, and 0.0722.
// Alpha is preserved without modification.
float gray = luminance(inputColor.rgb);
outputColor = vec4(vec3(gray), inputColor.a);
