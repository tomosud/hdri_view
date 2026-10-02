// @name Swap red and blue (swizzle)
// @category Channels and color
// @generator false
// @order 170

// Swap the red and blue channels with a GLSL swizzle.
//
// inputColor.bgra means B becomes R, G stays G, R becomes B,
// and A stays A. Try other swizzles such as grba or rrrr.
outputColor = inputColor.bgra;
