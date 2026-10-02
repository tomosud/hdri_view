// @name YUV to RGB (Rec.709)
// @category Channels and color
// @generator false
// @order 190

// Convert full-range Rec.709 YUV back to linear RGB.
//
// Expected input channel layout:
//   R = Y (luminance)
//   G = U (blue difference, signed)
//   B = V (red difference, signed)
//
// This is the inverse of the RGB to YUV preset.
float y = inputColor.r;
float u = inputColor.g;
float v = inputColor.b;

float red = y + 1.5748 * v;
float blue = y + 1.8556 * u;
float green = (y - 0.2126 * red - 0.0722 * blue) / 0.7152;

outputColor = vec4(red, green, blue, inputColor.a);
