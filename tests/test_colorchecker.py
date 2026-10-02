import importlib.util
import json
from pathlib import Path
import re
import struct
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('chart', ROOT / 'scripts/generate_colorchecker.py')
chart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chart)


class ColorCheckerTests(unittest.TestCase):
    def test_reference_white_and_black(self):
        for value in chart.lab_to_linear([100, 0, 0], [0.9642, 1, 0.8249]):
            self.assertAlmostEqual(value, 1, places=5)
        self.assertEqual(chart.lab_to_linear([0, 0, 0], [0.9642, 1, 0.8249]), [0, 0, 0])
        self.assertEqual(chart.quantize(0.18, 8), 118)

    def test_png_pixels_and_shader_agree(self):
        data = json.loads((ROOT / 'exports/colorchecker/colorchecker-values.json').read_text())
        patches = data['patches']
        self.assertEqual(len(patches), 24)
        self.assertEqual([p['id'] for p in patches if p['clipped_channels']], ['F3'])
        shader = (ROOT / 'glsl-presets/colorchecker-classic-srgb.glsl').read_text()
        entries = re.findall(r'vec3\(([\d., ]+)\),? // ([A-F][1-4])', shader)
        self.assertEqual(len(entries), 24)
        for (values, patch_id), patch in zip(entries, patches):
            self.assertEqual(patch_id, patch['id'])
            linear = [float(v) for v in values.split(',')]
            for bits in (8, 16):
                self.assertEqual([chart.quantize(v, bits) for v in linear], patch[f'srgb{bits}'])
        for path in (ROOT / 'exports/colorchecker').glob('*.png'):
            with self.subTest(file=path.name):
                content = path.read_bytes()
                self.assertEqual(content[:8], b'\x89PNG\r\n\x1a\n')
                pos, chunks = 8, {}
                while pos < len(content):
                    size = struct.unpack('>I', content[pos:pos+4])[0]
                    kind = content[pos+4:pos+8]
                    payload = content[pos+8:pos+8+size]
                    crc = struct.unpack('>I', content[pos+8+size:pos+12+size])[0]
                    self.assertEqual(crc, zlib.crc32(kind + payload))
                    chunks[kind] = chunks.get(kind, b'') + payload
                    pos += size + 12
                width, height, bits, color, _, _, _ = struct.unpack('>IIBBBBB', chunks[b'IHDR'])
                self.assertEqual(color, 2)
                self.assertEqual(chunks[b'sRGB'], b'\x01')
                self.assertEqual(width * 2, height * 3)
                raw = zlib.decompress(chunks[b'IDAT'])
                stride, cell = width * 3 * (bits // 8) + 1, width // 6
                self.assertEqual(len(raw), stride * height)
                for i, patch in enumerate(patches):
                    x, y = (i % 6) * cell + cell // 2, (i // 6) * cell + cell // 2
                    offset = y * stride + 1 + x * 3 * (bits // 8)
                    rgb = struct.unpack('>3B' if bits == 8 else '>3H', raw[offset:offset+3*(bits//8)])
                    self.assertEqual(list(rgb), patch[f'srgb{bits}'])
                self.assertEqual(raw[1:1+3*(bits//8)], bytes(3*(bits//8)))


if __name__ == '__main__':
    unittest.main()
