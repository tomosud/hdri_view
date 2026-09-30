/* Image layout bridge only; all block decoding is performed by unmodified bcdec. */
#define BCDEC_IMPLEMENTATION
#define BCDEC_BC4BC5_PRECISE
#include "bcdec.h"

__attribute__((export_name("decode")))
void decode(const unsigned char* input, float* output, int width, int height, int format, int is_signed) {
    unsigned char rgba[64];
    float channels[48];
    int block_bytes = (format == 1 || format == 4) ? 8 : 16;
    for (int y = 0; y < height; y += 4) {
        for (int x = 0; x < width; x += 4, input += block_bytes) {
            switch (format) {
                case 1: bcdec_bc1(input, rgba, 16); break;
                case 2: bcdec_bc2(input, rgba, 16); break;
                case 3: bcdec_bc3(input, rgba, 16); break;
                case 4: bcdec_bc4_float(input, channels, 4, is_signed); break;
                case 5: bcdec_bc5_float(input, channels, 8, is_signed); break;
                case 6: bcdec_bc6h_float(input, channels, 12, is_signed); break;
                case 7: bcdec_bc7(input, rgba, 16); break;
                default: return;
            }
            int count = format == 6 ? 3 : format == 5 ? 2 : 1;
            for (int dy = 0; dy < 4 && y + dy < height; dy++) {
                for (int dx = 0; dx < 4 && x + dx < width; dx++) {
                    int src = dy * 4 + dx;
                    float* dst = output + ((y + dy) * width + x + dx) * 4;
                    for (int c = 0; c < 4; c++) {
                        dst[c] = format >= 4 && format <= 6
                            ? (c < count ? channels[src * count + c] : c == 3 ? 1.0f : 0.0f)
                            : rgba[src * 4 + c] / 255.0f;
                    }
                }
            }
        }
    }
}
