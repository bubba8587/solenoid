// GPU capability probe. Safety rule: offer the canvas renderer ONLY on a real
// hardware-backed context — a software canvas is SLOWER than DOM, so route it to DOM.

export type GpuTier = "webgpu" | "webgl2" | "none";

export interface GpuCapability {
  tier: GpuTier;
  /** The UNMASKED_RENDERER string when we got a WebGL2 context, else null. */
  renderer: string | null;
  /** True when the only context we could get is a software rasterizer. */
  software: boolean;
  /** Convenience: may the canvas renderer be offered? (tier !== "none"). */
  canUseCanvas: boolean;
}

// Software-rasterizer fingerprints as they appear in UNMASKED_RENDERER_WEBGL.
const SOFTWARE_FINGERPRINTS = [
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "software",
  "basic render driver", // Microsoft Basic Render Driver (WARP)
  "microsoft basic",
];

/** Case-insensitive fingerprint match; a null/empty renderer string counts as
 *  NOT-known-software, so a real WebGL2 context with a masked name still qualifies. */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  if (!renderer) return false;
  const r = renderer.toLowerCase();
  return SOFTWARE_FINGERPRINTS.some((f) => r.includes(f));
}

/** Pure tier decision. A WebGPU adapter that IS fallback is ignored — Chrome returns
 *  a SwiftShader-backed one on GPU-less machines, and software must never beat DOM. */
export function classifyCapability(
  webgpu: { isFallback: boolean } | null,
  webgl2Renderer: string | null,
): GpuCapability {
  if (webgpu && !webgpu.isFallback) {
    return { tier: "webgpu", renderer: webgl2Renderer, software: false, canUseCanvas: true };
  }
  if (webgl2Renderer !== null) {
    const software = isSoftwareRenderer(webgl2Renderer);
    return {
      tier: software ? "none" : "webgl2",
      renderer: webgl2Renderer,
      software,
      canUseCanvas: !software,
    };
  }
  return { tier: "none", renderer: null, software: false, canUseCanvas: false };
}

/** The UNMASKED_RENDERER string; "" when the context exists but its name is masked;
 *  null when no WebGL2 context could be created at all. */
function probeWebgl2Renderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ?? null;
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      const r = gl.getParameter(
        (dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
      );
      return typeof r === "string" ? r : "";
    }
    return "";
  } catch {
    return null;
  }
}

/** Never throws — any failure resolves to a DOM-safe capability. */
export async function probeGpu(): Promise<GpuCapability> {
  let webgpu: { isFallback: boolean } | null = null;
  try {
    // Structural type for navigator.gpu — the @webgpu/types lib isn't in our tsconfig.
    const gpu = (navigator as unknown as {
      gpu?: { requestAdapter?: () => Promise<{ isFallbackAdapter?: boolean } | null> };
    }).gpu;
    if (gpu && typeof gpu.requestAdapter === "function") {
      const adapter = await gpu.requestAdapter();
      if (adapter) webgpu = { isFallback: adapter.isFallbackAdapter === true };
    }
  } catch {
    webgpu = null;
  }
  const webgl2Renderer = probeWebgl2Renderer();
  return classifyCapability(webgpu, webgl2Renderer);
}
