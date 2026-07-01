/// <reference types="@webgpu/types" />
import { clipScaleOffset, type AreaTransform } from "./overlayTransform";
import { tessellatePolyline } from "./cableTessellate";
import { parsePathPoints } from "./cableHitTest";
import { cableScene } from "./cableScene";
import { parseColor, type RGBA } from "./cssColor";

// WebGPU cable renderer — the desktop (Tauri/WebView2) GPU path. Cable polylines are
// tessellated to triangle ribbons (cableTessellate) and uploaded to a GPU vertex
// buffer ONCE per scene change; pan/zoom only rewrites a 16-byte uniform (world→clip
// scale+offset) and submits one draw. 4× MSAA keeps cables smooth in motion.
//
// WebView2 needs `--enable-unsafe-webgpu` (set in src-tauri/tauri.conf.json
// additionalBrowserArgs). Creation is async (requestAdapter/requestDevice); the
// factory resolves null on any failure so the caller falls back to DOM. Premultiplied
// alpha so the transparent canvas composites correctly over the DOM behind it.

const SAMPLE_COUNT = 4;

const WGSL = /* wgsl */ `
struct Uniforms { scale: vec2f, offset: vec2f };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs(@location(0) pos: vec2f, @location(1) color: vec4f) -> VSOut {
  var out: VSOut;
  out.pos = vec4f(pos * u.scale + u.offset, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return in.color; // already premultiplied
}
`;

export interface CableColorResolver {
  (color: string): RGBA;
}

export class GpuCableRenderer {
  private vertexCount = 0;
  private posBuf: GPUBuffer | null = null;
  private colBuf: GPUBuffer | null = null;
  private posCap = 0;
  private colCap = 0;
  private msaa: GPUTexture | null = null;
  private msaaW = 0;
  private msaaH = 0;
  private disposed = false;
  private readonly uniformData = new Float32Array(4);

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly pipeline: GPURenderPipeline,
    private readonly uniformBuf: GPUBuffer,
    private readonly bindGroup: GPUBindGroup,
    onLost?: () => void,
  ) {
    // Device loss (driver reset, TDR, sleep/wake) blanks the GPU layer. Mark disposed
    // and notify so the caller can fall back to DOM — the renderer-plan flags GPU
    // context loss as a real hazard; cables must never silently vanish.
    device.lost
      .then(() => { if (!this.disposed) { this.disposed = true; onLost?.(); } })
      .catch(() => { if (!this.disposed) { this.disposed = true; onLost?.(); } });
  }

  /** Async factory. Resolves null if WebGPU is unavailable / fails (caller → DOM).
   *  `onLost` fires if the GPU device is lost after creation. */
  static async create(canvas: HTMLCanvasElement, onLost?: () => void): Promise<GpuCableRenderer | null> {
    try {
      const gpu = navigator.gpu;
      if (!gpu) { console.warn("[gpu/cable] no navigator.gpu (WebGPU not exposed)"); return null; }
      const adapter = await gpu.requestAdapter();
      if (!adapter) { console.warn("[gpu/cable] requestAdapter() returned null"); return null; }
      const device = await adapter.requestDevice();
      const context = canvas.getContext("webgpu");
      if (!context) { console.warn("[gpu/cable] getContext('webgpu') returned null"); return null; }
      const format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });

      const module = device.createShaderModule({ code: WGSL });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module, entryPoint: "vs",
          buffers: [
            { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
            { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] },
          ],
        },
        fragment: {
          module, entryPoint: "fs",
          targets: [{
            format,
            blend: {
              // Premultiplied-alpha over: out = src + dst·(1−srcA).
              color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
        multisample: { count: SAMPLE_COUNT },
      });

      const uniformBuf = device.createBuffer({
        size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
      });

      return new GpuCableRenderer(canvas, device, context, format, pipeline, uniformBuf, bindGroup, onLost);
    } catch (e) {
      console.warn("[gpu/cable] create() threw", e);
      return null;
    }
  }

  /** Rebuild + upload geometry for the current cable scene. On scene change, not pan. */
  setGeometry(resolve: CableColorResolver, want: (above: boolean) => boolean = () => true): void {
    if (this.disposed) return;
    const positions: number[] = [];
    const colors: number[] = [];
    for (const [, s] of cableScene.entries()) {
      if (!want(!!s.above)) continue;
      const before = positions.length;
      const added = tessellatePolyline(parsePathPoints(s.d), s.width, positions);
      if (added === 0) continue;
      const c = resolve(s.color);
      const a = c.a * s.opacity;
      // Premultiplied: store colour × alpha.
      const r = (c.r / 255) * a, g = (c.g / 255) * a, b = (c.b / 255) * a;
      const verts = (positions.length - before) / 2;
      for (let i = 0; i < verts; i++) colors.push(r, g, b, a);
    }
    this.vertexCount = positions.length / 2;

    const posArr = new Float32Array(positions);
    const colArr = new Float32Array(colors);
    this.posBuf = this.ensureBuffer(this.posBuf, posArr.byteLength, "pos");
    this.colBuf = this.ensureBuffer(this.colBuf, colArr.byteLength, "col");
    if (this.posBuf && posArr.byteLength) this.device.queue.writeBuffer(this.posBuf, 0, posArr);
    if (this.colBuf && colArr.byteLength) this.device.queue.writeBuffer(this.colBuf, 0, colArr);
  }

  private ensureBuffer(buf: GPUBuffer | null, byteLength: number, which: "pos" | "col"): GPUBuffer | null {
    if (byteLength === 0) return buf;
    const cap = which === "pos" ? this.posCap : this.colCap;
    if (buf && cap >= byteLength) return buf;
    buf?.destroy();
    // Grow with headroom so frequent small changes don't reallocate every time.
    const size = Math.max(byteLength, Math.ceil(byteLength * 1.5));
    const next = this.device.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    if (which === "pos") this.posCap = size; else this.colCap = size;
    return next;
  }

  /** Size the drawing buffer to the viewport × dpr (only when changed). */
  resize(cssW: number, cssH: number, dpr: number): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  private ensureMsaa(w: number, h: number): GPUTexture {
    if (this.msaa && this.msaaW === w && this.msaaH === h) return this.msaa;
    this.msaa?.destroy();
    this.msaa = this.device.createTexture({
      size: [w, h], sampleCount: SAMPLE_COUNT, format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaW = w; this.msaaH = h;
    return this.msaa;
  }

  /** Draw the uploaded geometry at the given transform (the cheap pan/zoom path). */
  draw(transform: AreaTransform, cssW: number, cssH: number): void {
    if (this.disposed) return;
    let target: GPUTexture;
    try { target = this.context.getCurrentTexture(); }
    catch { return; } // context not ready / lost
    const view = target.createView();
    const msaaView = this.ensureMsaa(this.canvas.width, this.canvas.height).createView();

    const { scale, offset } = clipScaleOffset(transform, cssW, cssH);
    this.uniformData[0] = scale[0]; this.uniformData[1] = scale[1];
    this.uniformData[2] = offset[0]; this.uniformData[3] = offset[1];
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaaView,
        resolveTarget: view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store", // 'store' on a multisampled attachment is fine; resolve writes `view`
      }],
    });
    if (this.vertexCount > 0 && this.posBuf && this.colBuf) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.posBuf);
      pass.setVertexBuffer(1, this.colBuf);
      pass.draw(this.vertexCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.posBuf?.destroy();
    this.colBuf?.destroy();
    this.uniformBuf.destroy();
    this.msaa?.destroy();
  }

  /** Clear to transparent (one empty draw) then dispose — used when leaving canvas mode. */
  clearAndDispose(transform: AreaTransform, cssW: number, cssH: number): void {
    if (!this.disposed) { this.vertexCount = 0; this.draw(transform, cssW, cssH); }
    this.dispose();
  }
}

/** `var(--…)`-aware colour resolver (getComputedStyle), cached; clear on theme change. */
export function makeColorResolver(): CableColorResolver & { clear(): void } {
  const cache = new Map<string, RGBA>();
  const FALLBACK: RGBA = { r: 160, g: 170, b: 190, a: 1 };
  const fn = ((color: string): RGBA => {
    const hit = cache.get(color);
    if (hit) return hit;
    let css = color;
    if (color.startsWith("var(")) {
      const name = color.slice(4, color.indexOf(")")).trim().split(",")[0].trim();
      try { css = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || color; }
      catch { /* keep literal */ }
    }
    const rgba = parseColor(css) ?? FALLBACK;
    cache.set(color, rgba);
    return rgba;
  }) as CableColorResolver & { clear(): void };
  fn.clear = () => cache.clear();
  return fn;
}
