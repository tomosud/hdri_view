// @name RGB to YUV (Rec.709)
// @category Channels and color
// @generator false
// @order 180

// Convert linear RGB to full-range Rec.709 YUV values.
//
// Output channels contain:
//   R = Y (luminance)
//   G = U (blue difference, signed)
//   B = V (red difference, signed)
//
// U and V can be negative. They are intentionally not shifted by 0.5,
// so OpenEXR export preserves the mathematical values.
float y = luminance(inputColor.rgb);
float u = (inputColor.b - y) / 1.8556;
float v = (inputColor.r - y) / 1.5748;

outputColor = vec4(y, u, v, inputColor.a);
