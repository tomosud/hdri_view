const MAX_CACHED_TILES = 96;
const HDR_REFERENCE_WHITE_NITS = 203;

const BACKGROUND_SHADER = /* wgsl */`
struct DisplayParams {
  p0: vec4<f32>,
  p1: vec4<f32>,
  p2: vec4<f32>,
  // smooth, devicePixelRatio, displayGamma, invert
  p3: vec4<f32>,
};

struct BackgroundVertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayParams;

@vertex fn backgroundVertex(@builtin(vertex_index) vertexIndex: u32) -> BackgroundVertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var output: BackgroundVertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment fn backgroundFragment(input: BackgroundVertexOutput) -> @location(0) vec4<f32> {
  let cellSize = 16.0 * max(display.p3.y, 1.0);
  let cell = vec2<i32>(floor(input.position.xy / cellSize));
  let alternate = (cell.x + cell.y) & 1;
  let dark = vec3<f32>(0.035, 0.043, 0.055);
  let light = vec3<f32>(0.051, 0.063, 0.078);
  return vec4<f32>(select(dark, light, alternate != 0), 1.0);
}
`;

const SHADER = /* wgsl */`
struct VertexInput {
  @location(0) position: vec2<f32>,
  @location(1) texel: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texel: vec2<f32>,
};

struct DisplayParams {
  // mode, brightness, autoLevel, logNormalize
  p0: vec4<f32>,
  // levelOffset, levelScale, absoluteNits, outputHdr
  p1: vec4<f32>,
  // logEpsilon, logMin, logRange, referenceWhiteNits
  p2: vec4<f32>,
  // smooth, devicePixelRatio, displayGamma, invert
  p3: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> display: DisplayParams;

@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.position, 0.0, 1.0);
  output.texel = input.texel;
  return output;
}

fn loadClamped(position: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture));
  return textureLoad(sourceTexture, clamp(position, vec2<i32>(0), dimensions - 1), 0);
}

fn sampleSource(texel: vec2<f32>) -> vec4<f32> {
  if (display.p3.x < 0.5) {
    return loadClamped(vec2<i32>(floor(texel)));
  }
  let centered = texel - vec2<f32>(0.5);
  let base = vec2<i32>(floor(centered));
  let fraction = fract(centered);
  let top = mix(loadClamped(base), loadClamped(base + vec2<i32>(1, 0)), fraction.x);
  let bottom = mix(loadClamped(base + vec2<i32>(0, 1)), loadClamped(base + vec2<i32>(1, 1)), fraction.x);
  return mix(top, bottom, fraction.y);
}

fn applyDisplayGamma(rgb: vec3<f32>) -> vec3<f32> {
  return pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(display.p3.z));
}

fn acesToneMap(value: f32) -> f32 {
  let x = max(value, 0.0) * 0.6;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

fn gamutSaturation(channel: f32, luminance: f32) -> f32 {
  if (channel < 0.0 && channel < luminance) {
    return luminance / max(luminance - channel, 1e-9);
  }
  if (channel > 1.0 && channel > luminance) {
    return (1.0 - luminance) / max(channel - luminance, 1e-9);
  }
  return 1.0;
}

fn toneMapAbsolute(rgb: vec3<f32>, brightness: f32, referenceWhite: f32) -> vec3<f32> {
  let luminance = max(0.0, dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722)));
  if (luminance <= 1e-9) {
    return vec3<f32>(0.0);
  }
  let mappedLuminance = acesToneMap(luminance / referenceWhite * max(brightness, 0.0));
  let scaled = rgb * (mappedLuminance / luminance);
  let saturation = clamp(min(
    gamutSaturation(scaled.r, mappedLuminance),
    min(gamutSaturation(scaled.g, mappedLuminance), gamutSaturation(scaled.b, mappedLuminance))
  ), 0.0, 1.0);
  return mix(vec3<f32>(mappedLuminance), scaled, saturation);
}

fn normalizedLogValue(value: f32) -> f32 {
  let safeValue = max(value, 0.0);
  return (log2(safeValue + display.p2.x) - display.p2.y) / display.p2.z;
}

fn limitNormalizedRgb(value: f32) -> f32 {
  // Extended HDR must retain values above reference white. SDR is bounded by design.
  if (display.p1.w > 0.5) {
    return max(value, 0.0);
  }
  return clamp(value, 0.0, 1.0);
}

fn normalizedScalar(value: f32) -> f32 {
  // Alpha visualization is always a normalized scalar, even on an HDR canvas.
  if (display.p0.w > 0.5) {
    return clamp(normalizedLogValue(value * display.p0.y), 0.0, 1.0);
  }
  if (display.p0.z > 0.5) {
    return clamp((value - display.p1.x) * display.p1.y * display.p0.y, 0.0, 1.0);
  }
  return clamp(value * display.p0.y, 0.0, 1.0);
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let source = sampleSource(input.texel);
  let mode = i32(round(display.p0.x));
  let alpha = clamp(source.a, 0.0, 1.0);

  if (mode == 5) {
    let value = normalizedScalar(source.a);
    return vec4<f32>(applyDisplayGamma(vec3<f32>(value)), 1.0);
  }

  var rgb = source.rgb;
  if (mode == 2) {
    rgb = vec3<f32>(source.r);
  } else if (mode == 3) {
    rgb = vec3<f32>(source.g);
  } else if (mode == 4) {
    rgb = vec3<f32>(source.b);
  }

  var linearOutput: vec3<f32>;
  if (display.p0.w > 0.5) {
    linearOutput = vec3<f32>(
      limitNormalizedRgb(normalizedLogValue(rgb.r * display.p0.y)),
      limitNormalizedRgb(normalizedLogValue(rgb.g * display.p0.y)),
      limitNormalizedRgb(normalizedLogValue(rgb.b * display.p0.y))
    );
  } else if (display.p0.z > 0.5) {
    let normalized = (rgb - vec3<f32>(display.p1.x)) * display.p1.y * display.p0.y;
    if (display.p1.w > 0.5) {
      // At 0 EV the source maximum is reference white. Positive EV may extend above it.
      linearOutput = max(normalized, vec3<f32>(0.0));
    } else {
      linearOutput = clamp(normalized, vec3<f32>(0.0), vec3<f32>(1.0));
    }
  } else if (display.p1.w > 0.5) {
    linearOutput = rgb * display.p0.y;
    if (display.p1.z > 0.5) {
      linearOutput /= display.p2.w;
    }
  } else if (display.p1.z > 0.5) {
    linearOutput = toneMapAbsolute(rgb, display.p0.y, display.p2.w);
  } else {
    linearOutput = rgb * display.p0.y;
  }

  var output = applyDisplayGamma(linearOutput);
  if (display.p3.w > 0.5) {
    output = vec3<f32>(1.0) - output;
  }
  if (mode == 0) {
    output *= alpha;
  }
  return vec4<f32>(output, 1.0);
}
`;

export async function createWebGpuRenderer({ onNeedsRender = null, onError = null } = {}) {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported by this browser.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("A WebGPU adapter is not available.");
  }
  const device = await adapter.requestDevice();
  return new WebGpuImageRenderer(device, { onNeedsRender, onError });
}

class WebGpuImageRenderer {
  constructor(device, { onNeedsRender, onError }) {
    this.device = device;
    this.onNeedsRender = onNeedsRender;
    this.onError = onError;
    this.preferredFormat = navigator.gpu.getPreferredCanvasFormat();
    this.backgroundShaderModule = device.createShaderModule({ code: BACKGROUND_SHADER });
    this.shaderModule = device.createShaderModule({ code: SHADER });
    this.backgroundPipelines = new Map();
    this.pipelines = new Map();
    this.canvasStates = new WeakMap();
    this.hdrQuery = matchMedia("(dynamic-range: high)");
    this.hdrQuery.addEventListener?.("change", () => this.onNeedsRender?.());
    device.lost.then((info) => {
      this.onError?.(new Error(`WebGPU device lost: ${info.message || info.reason}`));
    });
  }

  get hdrDisplayCapable() {
    return this.hdrQuery.matches;
  }

  render(canvas, frame) {
    const state = this.ensureCanvasState(canvas);
    this.ensureSourceState(state, frame.image);
    const requestedHdr = frame.outputMode === "hdr" || (frame.outputMode === "auto" && this.hdrDisplayCapable);
    this.configureCanvas(state, canvas, requestedHdr);

    const pipeline = this.pipelineFor(state.format);
    const backgroundPipeline = this.backgroundPipelineFor(state.format);
    this.writeDisplayUniform(state, frame.display, state.actualHdr, frame.dpr);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: state.context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });
    let backgroundBindGroup = state.backgroundBindGroups.get(state.format);
    if (!backgroundBindGroup) {
      backgroundBindGroup = this.device.createBindGroup({
        layout: backgroundPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: state.uniformBuffer } }]
      });
      state.backgroundBindGroups.set(state.format, backgroundBindGroup);
    }
    pass.setPipeline(backgroundPipeline);
    pass.setBindGroup(0, backgroundBindGroup);
    pass.draw(3);
    pass.setPipeline(pipeline);

    const overview = this.overviewResource(state, frame.image);
    if (overview) {
      this.drawResource(pass, pipeline, state, overview, frame.image.view.offsetX, frame.image.view.offsetY,
        frame.image.width * frame.image.view.scale, frame.image.height * frame.image.view.scale,
        frame.cssWidth, frame.cssHeight, 0, 0, overview.width, overview.height);
    }

    const visible = visibleTileRange(frame.image, frame.cssWidth, frame.cssHeight, frame.dpr, frame.tileSize);
    if (visible) {
      for (let tileY = visible.firstTileY; tileY <= visible.lastTileY; tileY += 1) {
        for (let tileX = visible.firstTileX; tileX <= visible.lastTileX; tileX += 1) {
          const resource = this.tileResource(state, frame.image, visible.level, tileX, tileY, frame.tileSize);
          if (!resource) continue;
          const sourceX = tileX * frame.tileSize * visible.factor;
          const sourceY = tileY * frame.tileSize * visible.factor;
          const sourceWidth = Math.min(resource.width * visible.factor, frame.image.width - sourceX);
          const sourceHeight = Math.min(resource.height * visible.factor, frame.image.height - sourceY);
          this.drawResource(
            pass, pipeline, state, resource,
            frame.image.view.offsetX + sourceX * frame.image.view.scale,
            frame.image.view.offsetY + sourceY * frame.image.view.scale,
            sourceWidth * frame.image.view.scale,
            sourceHeight * frame.image.view.scale,
            frame.cssWidth, frame.cssHeight,
            resource.gutter, resource.gutter, resource.width, resource.height
          );
        }
      }
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return {
      requested: frame.outputMode,
      hdrDisplayCapable: this.hdrDisplayCapable,
      actualMode: state.actualHdr ? "hdr" : "sdr",
      format: state.format,
      toneMapping: state.toneMapping,
      fallback: requestedHdr && !state.actualHdr
    };
  }

  disposeCanvas(canvas) {
    const state = this.canvasStates.get(canvas);
    if (!state) return;
    destroySourceResources(state);
    state.uniformBuffer.destroy();
    state.context.unconfigure?.();
    this.canvasStates.delete(canvas);
  }

  invalidateCanvas(canvas) {
    const state = canvas ? this.canvasStates.get(canvas) : null;
    if (state) destroySourceResources(state);
  }

  ensureCanvasState(canvas) {
    let state = this.canvasStates.get(canvas);
    if (state) return state;
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Could not create a WebGPU canvas context.");
    state = {
      context,
      configuredKey: "",
      format: this.preferredFormat,
      toneMapping: "standard",
      actualHdr: false,
      backgroundBindGroups: new Map(),
      source: null,
      tileCache: new Map(),
      pendingTiles: new Map(),
      overview: null,
      uniformBuffer: this.device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
    };
    this.canvasStates.set(canvas, state);
    return state;
  }

  configureCanvas(state, canvas, requestedHdr) {
    const desiredKey = `${requestedHdr ? "hdr" : "sdr"}:${canvas.width}x${canvas.height}`;
    if (state.configuredKey === desiredKey) return;

    if (requestedHdr) {
      try {
        state.context.configure({
          device: this.device,
          format: "rgba16float",
          colorSpace: "srgb",
          alphaMode: "opaque",
          toneMapping: { mode: "extended" }
        });
        const configuration = state.context.getConfiguration?.();
        state.format = configuration?.format || "rgba16float";
        state.toneMapping = configuration?.toneMapping?.mode || "extended";
        state.actualHdr = state.toneMapping === "extended";
        state.configuredKey = desiredKey;
        return;
      } catch (error) {
        this.onError?.(new Error(`HDR canvas unavailable; using SDR: ${error.message || error}`));
      }
    }

    state.context.configure({
      device: this.device,
      format: this.preferredFormat,
      colorSpace: "srgb",
      alphaMode: "opaque",
      toneMapping: { mode: "standard" }
    });
    const configuration = state.context.getConfiguration?.();
    state.format = configuration?.format || this.preferredFormat;
    state.toneMapping = configuration?.toneMapping?.mode || "standard";
    state.actualHdr = false;
    state.configuredKey = desiredKey;
  }

  pipelineFor(format) {
    let pipeline = this.pipelines.get(format);
    if (pipeline) return pipeline;
    pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: this.shaderModule,
        entryPoint: "vertexMain",
        buffers: [{
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x2" }
          ]
        }]
      },
      fragment: {
        module: this.shaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format }]
      },
      primitive: { topology: "triangle-list" }
    });
    this.pipelines.set(format, pipeline);
    return pipeline;
  }

  backgroundPipelineFor(format) {
    let pipeline = this.backgroundPipelines.get(format);
    if (pipeline) return pipeline;
    pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: this.backgroundShaderModule,
        entryPoint: "backgroundVertex"
      },
      fragment: {
        module: this.backgroundShaderModule,
        entryPoint: "backgroundFragment",
        targets: [{ format }]
      },
      primitive: { topology: "triangle-list" }
    });
    this.backgroundPipelines.set(format, pipeline);
    return pipeline;
  }

  writeDisplayUniform(state, display, outputHdr, dpr) {
    const values = new Float32Array(16);
    values.set([
      channelModeIndex(display.mode), display.brightness,
      display.autoLevel ? 1 : 0, display.logNormalize ? 1 : 0,
      display.levelOffset, display.levelScale,
      display.absoluteNits ? 1 : 0, outputHdr ? 1 : 0,
      display.logEpsilon || 1e-6, display.logMin || 0, display.logRange || 1,
      HDR_REFERENCE_WHITE_NITS,
      display.smooth ? 1 : 0, dpr, display.displayGamma || (1 / 2.2), display.invert ? 1 : 0
    ]);
    this.device.queue.writeBuffer(state.uniformBuffer, 0, values);
  }

  ensureSourceState(state, image) {
    if (state.source === image.rasterSource) return;
    destroySourceResources(state);
    state.source = image.rasterSource;
  }

  overviewResource(state, image) {
    const overview = image.overview;
    if (!overview?.pixels || overview.width < 1 || overview.height < 1) return null;
    if (state.overview?.pixels === overview.pixels) return state.overview.resource;
    state.overview?.resource && destroyResource(state.overview.resource);
    const resource = this.createTextureResource({
      width: overview.width,
      height: overview.height,
      gutter: 0,
      stride: overview.width,
      pixels: overview.pixels
    });
    state.overview = { pixels: overview.pixels, resource };
    return resource;
  }

  tileResource(state, image, level, tileX, tileY, tileSize) {
    const key = `${level}:${tileX}:${tileY}`;
    const cached = state.tileCache.get(key);
    if (cached) {
      state.tileCache.delete(key);
      state.tileCache.set(key, cached);
      return cached;
    }
    if (state.pendingTiles.has(key)) return null;

    let tile;
    try {
      tile = image.rasterSource.getTile(level, tileX, tileY, 1);
    } catch (error) {
      this.onError?.(error);
      return null;
    }
    if (tile && typeof tile.then === "function") {
      const source = state.source;
      const pending = tile.then((resolved) => {
        state.pendingTiles.delete(key);
        if (state.source !== source || !resolved) return;
        const resource = this.createTextureResource(resolved);
        state.tileCache.set(key, resource);
        trimTileCache(state.tileCache);
        this.onNeedsRender?.();
      }).catch((error) => {
        state.pendingTiles.delete(key);
        this.onError?.(error);
      });
      state.pendingTiles.set(key, pending);
      return null;
    }
    if (!tile) return null;
    const resource = this.createTextureResource(tile);
    state.tileCache.set(key, resource);
    trimTileCache(state.tileCache);
    return resource;
  }

  createTextureResource({ width, height, gutter = 0, stride = width, pixels }) {
    const textureWidth = width + gutter * 2;
    const textureHeight = height + gutter * 2;
    const texture = this.device.createTexture({
      size: [textureWidth, textureHeight, 1],
      format: "rgba32float",
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
    });
    uploadFloat32Texture(this.device, texture, pixels, textureWidth, textureHeight, stride);
    return {
      texture,
      view: texture.createView(),
      vertexBuffer: this.device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      }),
      bindGroups: new Map(),
      width,
      height,
      gutter
    };
  }

  drawResource(pass, pipeline, state, resource, x, y, width, height, canvasWidth, canvasHeight,
    texelX, texelY, texelWidth, texelHeight) {
    if (width <= 0 || height <= 0) return;
    const left = x / canvasWidth * 2 - 1;
    const right = (x + width) / canvasWidth * 2 - 1;
    const top = 1 - y / canvasHeight * 2;
    const bottom = 1 - (y + height) / canvasHeight * 2;
    const u0 = texelX;
    const v0 = texelY;
    const u1 = texelX + texelWidth;
    const v1 = texelY + texelHeight;
    const vertices = new Float32Array([
      left, top, u0, v0,
      right, top, u1, v0,
      left, bottom, u0, v1,
      left, bottom, u0, v1,
      right, top, u1, v0,
      right, bottom, u1, v1
    ]);
    this.device.queue.writeBuffer(resource.vertexBuffer, 0, vertices);
    let bindGroup = resource.bindGroups.get(state.format);
    if (!bindGroup) {
      bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resource.view },
          { binding: 1, resource: { buffer: state.uniformBuffer } }
        ]
      });
      resource.bindGroups.set(state.format, bindGroup);
    }
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, resource.vertexBuffer);
    pass.draw(6);
  }
}

function visibleTileRange(image, canvasWidth, canvasHeight, dpr, tileSize) {
  if (!image.rasterSource || image.width < 1 || image.height < 1 || image.view.scale <= 0) return null;
  const sourcePixelsPerDevicePixel = 1 / Math.max(0.000001, image.view.scale * dpr);
  const maximumLevel = Math.max(0, Math.ceil(Math.log2(Math.max(image.width, image.height))));
  const level = clamp(Math.floor(Math.log2(Math.max(1, sourcePixelsPerDevicePixel))), 0, maximumLevel);
  const factor = 2 ** level;
  const levelWidth = Math.ceil(image.width / factor);
  const levelHeight = Math.ceil(image.height / factor);
  const sourceLeft = Math.max(0, -image.view.offsetX / image.view.scale);
  const sourceTop = Math.max(0, -image.view.offsetY / image.view.scale);
  const sourceRight = Math.min(image.width, (canvasWidth - image.view.offsetX) / image.view.scale);
  const sourceBottom = Math.min(image.height, (canvasHeight - image.view.offsetY) / image.view.scale);
  if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) return null;
  return {
    level,
    factor,
    firstTileX: clamp(Math.floor(sourceLeft / factor / tileSize), 0, Math.ceil(levelWidth / tileSize) - 1),
    lastTileX: clamp(Math.floor((sourceRight - 1) / factor / tileSize), 0, Math.ceil(levelWidth / tileSize) - 1),
    firstTileY: clamp(Math.floor(sourceTop / factor / tileSize), 0, Math.ceil(levelHeight / tileSize) - 1),
    lastTileY: clamp(Math.floor((sourceBottom - 1) / factor / tileSize), 0, Math.ceil(levelHeight / tileSize) - 1)
  };
}

function uploadFloat32Texture(device, texture, pixels, width, height, stride) {
  const rowFloats = width * 4;
  const paddedRowBytes = Math.ceil(rowFloats * 4 / 256) * 256;
  const paddedRowFloats = paddedRowBytes / 4;
  let upload = pixels;
  if (stride * 4 !== paddedRowFloats || pixels.length < paddedRowFloats * height) {
    upload = new Float32Array(paddedRowFloats * height);
    for (let y = 0; y < height; y += 1) {
      upload.set(pixels.subarray(y * stride * 4, y * stride * 4 + rowFloats), y * paddedRowFloats);
    }
  }
  device.queue.writeTexture(
    { texture }, upload,
    { bytesPerRow: paddedRowBytes, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  );
}

function channelModeIndex(mode) {
  return { rgba: 0, rgb: 1, r: 2, g: 3, b: 4, a: 5 }[mode] ?? 0;
}

function trimTileCache(cache) {
  while (cache.size > MAX_CACHED_TILES) {
    const key = cache.keys().next().value;
    destroyResource(cache.get(key));
    cache.delete(key);
  }
}

function destroySourceResources(state) {
  for (const resource of state.tileCache.values()) destroyResource(resource);
  state.tileCache.clear();
  state.pendingTiles.clear();
  if (state.overview?.resource) destroyResource(state.overview.resource);
  state.overview = null;
  state.source = null;
}

function destroyResource(resource) {
  resource?.texture?.destroy();
  resource?.vertexBuffer?.destroy();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export { HDR_REFERENCE_WHITE_NITS };
