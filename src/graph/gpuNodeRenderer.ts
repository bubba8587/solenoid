/// <reference types="@webgpu/types" />
import { clipScaleOffset, type AreaTransform } from "./overlayTransform";
import { packNodeInstances, FLOATS_PER_INSTANCE, type NodeCard } from "./nodeInstances";

// WebGPU node-card renderer — the LOD representation of node bodies. NOT YET wired
// into the LOD swap (that's the next step); this draws the cards so alignment/color
// can be verified first. Each node is ONE instance of a unit quad; the fragment
// shader does the rounded-rect SDF + header/body split, so ALL nodes draw in a single
// instanced call — the cheap-to-composite stand-in for the DOM node layer when zoomed
// out. Same transform-uniform model as the cable renderer (geometry uploaded once;
// pan/zoom = uniform + one draw).

const SAMPLE_COUNT = 4;
const STRIDE = FLOATS_PER_INSTANCE * 4; // bytes per instance

const WGSL = /* wgsl */ `
struct Uniforms { scale: vec2f, offset: vec2f };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,     // pixel coords within the card [0..size]
  @location(1) size: vec2f,
  @location(2) body: vec4f,
  @location(3) header: vec4f,
  @location(4) params: vec2f,    // (radius, headerH)
};

@vertex
fn vs(
  @location(0) corner: vec2f,    // unit quad [0,1]
  @location(1) rect: vec4f,      // x,y,w,h (world)
  @location(2) body: vec4f,
  @location(3) header: vec4f,
  @location(4) params: vec2f,
) -> VSOut {
  let world = rect.xy + corner * rect.zw;
  var out: VSOut;
  out.pos = vec4f(world * u.scale + u.offset, 0.0, 1.0);
  out.local = corner * rect.zw;
  out.size = rect.zw;
  out.body = body;
  out.header = header;
  out.params = params;
  return out;
}

fn sdRoundRect(p: vec2f, half: vec2f, r: f32) -> f32 {
  let q = abs(p) - half + vec2f(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let half = in.size * 0.5;
  let p = in.local - half;
  let r = min(in.params.x, min(half.x, half.y));
  let d = sdRoundRect(p, half, r);
  let aa = max(fwidth(d), 1e-4);
  let cov = clamp(0.5 - d / aa, 0.0, 1.0);
  // Header bar across the top; body below. Colors are premultiplied already.
  let col = select(in.body, in.header, in.local.y < in.params.y);
  return col * cov;
}
`;

export class GpuNodeRenderer {
  private instanceCount = 0;
  private instBuf: GPUBuffer | null = null;
  private instCap = 0;
  private msaa: GPUTexture | null = null;
  private msaaW = 0;
  private msaaH = 0;
  private disposed = false;
  private readonly uniformData = new Float32Array(4);
  private readonly quadBuf: GPUBuffer;

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
    // Unit-quad (two triangles) in [0,1].
    const quad = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    this.quadBuf = device.createBuffer({ size: quad.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.quadBuf, 0, quad);
    device.lost
      .then(() => { if (!this.disposed) { this.disposed = true; onLost?.(); } })
      .catch(() => { if (!this.disposed) { this.disposed = true; onLost?.(); } });
  }

  static async create(canvas: HTMLCanvasElement, onLost?: () => void): Promise<GpuNodeRenderer | null> {
    try {
      const gpu = navigator.gpu;
      if (!gpu) return null;
      const adapter = await gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const context = canvas.getContext("webgpu");
      if (!context) return null;
      const format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });

      const module = device.createShaderModule({ code: WGSL });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module, entryPoint: "vs",
          buffers: [
            { arrayStride: 8, stepMode: "vertex", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
            {
              arrayStride: STRIDE, stepMode: "instance",
              attributes: [
                { shaderLocation: 1, offset: 0, format: "float32x4" },   // rect
                { shaderLocation: 2, offset: 16, format: "float32x4" },  // body
                { shaderLocation: 3, offset: 32, format: "float32x4" },  // header
                { shaderLocation: 4, offset: 48, format: "float32x2" },  // params
              ],
            },
          ],
        },
        fragment: {
          module, entryPoint: "fs",
          targets: [{
            format,
            blend: {
              color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
        multisample: { count: SAMPLE_COUNT },
      });

      const uniformBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
      });
      return new GpuNodeRenderer(canvas, device, context, format, pipeline, uniformBuf, bindGroup, onLost);
    } catch {
      return null;
    }
  }

  /** Upload the node cards. Call on a node geometry/color change, not on pan. */
  setNodes(cards: NodeCard[]): void {
    if (this.disposed) return;
    const data = packNodeInstances(cards);
    this.instanceCount = cards.length;
    if (data.byteLength === 0) return;
    if (!this.instBuf || this.instCap < data.byteLength) {
      this.instBuf?.destroy();
      const size = Math.max(data.byteLength, Math.ceil(data.byteLength * 1.5));
      this.instBuf = this.device.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.instCap = size;
    }
    this.device.queue.writeBuffer(this.instBuf, 0, data);
  }

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
    this.msaa = this.device.createTexture({ size: [w, h], sampleCount: SAMPLE_COUNT, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.msaaW = w; this.msaaH = h;
    return this.msaa;
  }

  draw(transform: AreaTransform, cssW: number, cssH: number): void {
    if (this.disposed) return;
    let target: GPUTexture;
    try { target = this.context.getCurrentTexture(); } catch { return; }
    const view = target.createView();
    const msaaView = this.ensureMsaa(this.canvas.width, this.canvas.height).createView();

    const { scale, offset } = clipScaleOffset(transform, cssW, cssH);
    this.uniformData[0] = scale[0]; this.uniformData[1] = scale[1];
    this.uniformData[2] = offset[0]; this.uniformData[3] = offset[1];
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: msaaView, resolveTarget: view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    if (this.instanceCount > 0 && this.instBuf) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.quadBuf);
      pass.setVertexBuffer(1, this.instBuf);
      pass.draw(6, this.instanceCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.quadBuf.destroy();
    this.instBuf?.destroy();
    this.uniformBuf.destroy();
    this.msaa?.destroy();
  }

  clearAndDispose(transform: AreaTransform, cssW: number, cssH: number): void {
    if (!this.disposed) { this.instanceCount = 0; this.draw(transform, cssW, cssH); }
    this.dispose();
  }
}
