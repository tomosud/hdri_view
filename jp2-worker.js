/* global OpenJPEGJS, importScripts */

importScripts("./vendor/openjpeg/openjpegjs_decode.js?v=1.3.0");

let codecPromise = null;

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  if (message.type !== "decode") {
    return;
  }
  let decoder = null;
  try {
    let lastProgress = -1;
    const report = (line) => {
      const match = /Tile (\d+)\/(\d+) has been decoded/.exec(String(line));
      if (!match) {
        return;
      }
      const progress = Math.floor((Number(match[1]) / Number(match[2])) * 100);
      if (progress >= lastProgress + 5 || progress === 100) {
        lastProgress = progress;
        self.postMessage({ type: "progress", progress, label: `JPEG 2000 ${progress}%` });
      }
    };
    codecPromise ||= OpenJPEGJS({ print: report, printErr: report });
    self.postMessage({ type: "progress", progress: 0, label: "Starting JPEG 2000 decode" });
    const codec = await codecPromise;
    const encoded = new Uint8Array(message.buffer);
    decoder = new codec.J2KDecoder();
    decoder.getEncodedBuffer(encoded.length).set(encoded);
    decoder.decodeSubResolution(message.level, 0);

    const frame = decoder.getFrameInfo();
    const size = decoder.calculateSizeAtDecompositionLevel(message.level);
    if (frame.componentCount !== 1 && frame.componentCount !== 3) {
      throw new Error(`Unsupported JPEG 2000 component count: ${frame.componentCount}.`);
    }
    if (frame.bitsPerSample < 1 || frame.bitsPerSample > 16) {
      throw new Error(`Unsupported JPEG 2000 bit depth: ${frame.bitsPerSample}.`);
    }

    const bytes = decoder.getDecodedBuffer();
    const bytesPerSample = frame.bitsPerSample <= 8 ? 1 : 2;
    const expectedSamples = size.width * size.height * frame.componentCount;
    if (bytes.byteLength < expectedSamples * bytesPerSample) {
      throw new Error("JPEG 2000 decoded buffer is truncated.");
    }
    const samples = bytesPerSample === 1
      ? bytes
      : frame.isSigned
        ? new Int16Array(bytes.buffer, bytes.byteOffset, expectedSamples)
        : new Uint16Array(bytes.buffer, bytes.byteOffset, expectedSamples);
    const sampleMax = 2 ** frame.bitsPerSample - 1;
    const signedOffset = frame.isSigned ? 2 ** (frame.bitsPerSample - 1) : 0;
    const pixels = new Float32Array(size.width * size.height * 4);
    const toLinear = new Float32Array(sampleMax + 1);
    for (let sample = 0; sample <= sampleMax; sample += 1) {
      const encodedValue = sample / sampleMax;
      toLinear[sample] = encodedValue <= 0.04045
        ? encodedValue / 12.92
        : ((encodedValue + 0.055) / 1.055) ** 2.4;
    }

    for (let source = 0, target = 0; source < expectedSamples; source += frame.componentCount, target += 4) {
      const first = Math.max(0, Math.min(sampleMax, samples[source] + signedOffset));
      if (frame.componentCount === 1) {
        const value = toLinear[first];
        pixels[target] = value;
        pixels[target + 1] = value;
        pixels[target + 2] = value;
      } else {
        const green = Math.max(0, Math.min(sampleMax, samples[source + 1] + signedOffset));
        const blue = Math.max(0, Math.min(sampleMax, samples[source + 2] + signedOffset));
        pixels[target] = toLinear[first];
        pixels[target + 1] = toLinear[green];
        pixels[target + 2] = toLinear[blue];
      }
      pixels[target + 3] = 1;
    }

    decoder.delete();
    decoder = null;
    self.postMessage({ type: "result", width: size.width, height: size.height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    decoder?.delete?.();
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
});
