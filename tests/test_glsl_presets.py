import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "generator", Path(__file__).resolve().parents[1] / "scripts/generate_glsl_presets.py")
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class PresetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "out.js"
        self.write("filter", default="filter", generator_value="false")
        self.write("generator", default="generator")

    def write(self, name, default=None, generator_value="true", body=None):
        text = f"// @name {name}\n// @category Test\n// @generator {generator_value}\n"
        if default:
            text += f"// @default {default}\n"
        text += "\n" + (body if body is not None else "outputColor = vec4(1.0);\n")
        path = self.root / f"{name}.glsl"
        path.write_text(text, encoding="utf-8")
        return path

    def test_add_edit_remove_and_determinism(self):
        self.assertEqual(generator.generate(self.root, self.output), 2)
        path = self.write("日本語", body='// ` ${literal} \\\noutputColor = vec4(2.0);\n')
        self.assertEqual(generator.generate(self.root, self.output), 3)
        first = self.output.read_bytes()
        generator.generate(self.root, self.output)
        self.assertEqual(first, self.output.read_bytes())
        self.write("日本語", body="outputColor = vec4(3.0);\n")
        generator.generate(self.root, self.output)
        self.assertNotEqual(first, self.output.read_bytes())
        path.unlink()
        self.assertEqual(generator.generate(self.root, self.output), 2)

    def test_invalid_preserves_output(self):
        generator.generate(self.root, self.output)
        previous = self.output.read_bytes()
        for kwargs in ({"generator_value": "yes"}, {"body": ""}, {"default": "generator"}):
            with self.subTest(kwargs=kwargs):
                self.write("bad", **kwargs)
                with self.assertRaises(ValueError):
                    generator.generate(self.root, self.output)
                self.assertEqual(previous, self.output.read_bytes())

    def test_missing_defaults_and_metadata(self):
        (self.root / "filter.glsl").unlink()
        with self.assertRaisesRegex(ValueError, "Exactly one"):
            generator.generate(self.root, self.output)
        path = self.root / "missing.glsl"
        path.write_text("outputColor = vec4(1.0);", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "missing @name"):
            generator.read_preset(path)

    def test_duplicate_name(self):
        (self.root / "copy.glsl").write_bytes((self.root / "filter.glsl").read_bytes())
        with self.assertRaisesRegex(ValueError, "duplicate preset name"):
            generator.generate(self.root, self.output)


if __name__ == "__main__":
    unittest.main()
