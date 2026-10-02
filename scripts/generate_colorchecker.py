"""Reproduce the documented ColorChecker sRGB preset and PNGs, using stdlib only."""
import json
import math
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
# ICC sRGB specification, p.4: linear sRGB -> Bradford-adapted XYZ D50.
RGB_TO_XYZ_D50 = (
    (0.436030342570117, 0.385101860087134, 0.143067806654203),
    (0.222438466210245, 0.716942745571917, 0.060618777416563),
    (0.013897440074263, 0.097076381494207, 0.713926257896652),
)


def solve(matrix, vector):
    rows = [list(row) + [value] for row, value in zip(matrix, vector)]
    for i in range(3):
        pivot = max(range(i, 3), key=lambda j: abs(rows[j][i]))
        rows[i], rows[pivot] = rows[pivot], rows[i]
        divisor = rows[i][i]
        rows[i] = [v / divisor for v in rows[i]]
        for j in range(3):
            if j != i:
                factor = rows[j][i]
                rows[j] = [a - factor * b for a, b in zip(rows[j], rows[i])]
    return [row[3] for row in rows]


def lab_to_linear(lab, white):
    lightness, a, b = lab
    fy = (lightness + 16) / 116
    f = (fy + a / 500, fy, fy - b / 200)
    delta = 6 / 29
    xyz = [(v**3 if v > delta else 3 * delta**2 * (v - 4 / 29)) * w
           for v, w in zip(f, white)]
    return solve(RGB_TO_XYZ_D50, xyz)


def encode_srgb(value):
    value = min(1.0, max(0.0, value))
    return 12.92 * value if value <= 0.0031308 else 1.055 * value**(1 / 2.4) - 0.055


def quantize(value, bits):
    return math.floor(encode_srgb(value) * ((1 << bits) - 1) + 0.5)


def png_chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def write_png(path, width, height, patches, bits):
    # 6 x 4 square cells; each patch has a 1/16-cell inset on all sides.
    assert width * 2 == height * 3 and width % 96 == 0
    cell = width // 6
    inset = cell // 16
    pack = (lambda rgb: bytes(rgb)) if bits == 8 else (lambda rgb: struct.pack('>3H', *rgb))
    black = pack([0, 0, 0])
    rows = []
    for y in range(height):
        row = bytearray(b'\x00')
        patch_row, local_y = divmod(y, cell)
        for col in range(6):
            rgb = pack(patches[patch_row * 6 + col][f'srgb{bits}'])
            if inset <= local_y < cell - inset:
                row.extend(black * inset + rgb * (cell - 2 * inset) + black * inset)
            else:
                row.extend(black * cell)
        rows.append(row)
    data = b'\x89PNG\r\n\x1a\n'
    data += png_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, bits, 2, 0, 0, 0))
    data += png_chunk(b'sRGB', b'\x01')  # Relative colorimetric; standard sRGB transfer.
    data += png_chunk(b'tEXt', b'Description\x00ColorChecker Classic; X-Rite Nov2014 Lab D50; Bradford to sRGB D65; clipped; no black/white rescaling')
    data += png_chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
    data += png_chunk(b'IEND', b'')
    path.write_bytes(data)


def main():
    reference = json.loads((ROOT / 'reference-data/colorchecker-classic-2014.json').read_text(encoding='utf-8'))
    patches = []
    for patch in reference['patches']:
        linear = lab_to_linear(patch['lab'], reference['white_xyz'])
        patches.append({**patch, 'linear_srgb_unclipped': linear,
                        'clipped_channels': [name for name, value in zip('RGB', linear) if not 0 <= value <= 1],
                        'srgb8': [quantize(v, 8) for v in linear],
                        'srgb16': [quantize(v, 16) for v in linear]})
    output = ROOT / 'exports/colorchecker'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'colorchecker-values.json').write_text(json.dumps({
        **reference, 'conversion': 'ICC sRGB Bradford D50 matrix inverse; channel clipping; nearest integer quantization',
        'layout': '3:2; 6 columns x 4 rows; square cells with 1/16-cell inset; black background',
        'patches': patches}, indent=2) + '\n', encoding='utf-8')
    for width, height in [(768, 512), (1536, 1024), (3072, 2048)]:
        write_png(output / f'colorchecker-classic-srgb-{width}x{height}.png', width, height, patches, 8)
    write_png(output / 'colorchecker-classic-srgb-1536x1024-16bit.png', 1536, 1024, patches, 16)
    code = '''// @name ColorChecker Classic (2014+, sRGB)
// @category Generated images
// @generator true
// @order 300

// 24-patch digital reference; X-Rite November 2014 formulation and newer.
// Lab D50 source: https://babelcolor.com/index_htm_files/ColorChecker24_After_Nov2014.txt
// Conversion: https://registry.color.org/rgb-registry/files/sRGB.pdf (p.4 inverse matrix).
// Lab D50 -> XYZ D50 -> Bradford-adapted linear sRGB D65; no white/black rescaling.
// Out-of-sRGB components are clipped to [0,1]; alpha is one.
// Export size: 768x512, 1536x1024, 3072x2048 (3:2). Other ratios are letterboxed.
// PNG export: Current display, RGB, Linear, Auto level OFF, Brightness 0 EV,
// Display Gamma 1.0, Invert OFF, same dimensions (or Nearest).
// Do not use RAW PNG export: the viewer tone-maps GLSL/HDR sources there.
// Reproduce from reference-data via python scripts/generate_colorchecker.py.
const vec3 patches[24] = vec3[24](
'''
    for i, patch in enumerate(patches):
        values = ', '.join(f'{min(1.0, max(0.0, v)):.10f}' for v in patch['linear_srgb_unclipped'])
        code += f'    vec3({values})' + (',' if i < 23 else '') + f" // {patch['id']} {patch['name']}\n"
    code += ''');

// Preserve square patches at any output aspect ratio.
float cellSize = min(resolution.x / 6.0, resolution.y / 4.0);
vec2 offset = (resolution - cellSize * vec2(6.0, 4.0)) * 0.5;
vec2 grid = (uv * resolution - offset) / cellSize;
vec3 rgb = vec3(0.0);
if (all(greaterThanEqual(grid, vec2(0.0))) && all(lessThan(grid, vec2(6.0, 4.0)))) {
    ivec2 cell = ivec2(floor(grid));
    vec2 p = fract(grid);
    if (all(greaterThanEqual(p, vec2(0.0625))) && all(lessThan(p, vec2(0.9375)))) {
        rgb = patches[cell.y * 6 + cell.x];
    }
}
outputColor = vec4(rgb, 1.0);
'''
    (ROOT / 'glsl-presets/colorchecker-classic-srgb.glsl').write_text(code, encoding='utf-8', newline='\n')
    for patch in patches:
        print(patch['id'], patch['name'], patch['srgb8'], 'clipped=' + ''.join(patch['clipped_channels']))


if __name__ == '__main__':
    main()
