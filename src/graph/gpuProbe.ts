// GPU capability probe — decides whether a GPU-backed canvas renderer is even an
// option on this machine. The renderer plan's safety rule: light up the canvas
// layer ONLY on a real, hardware-backed GPU context; on failure (or a SOFTWARE
// context — SwiftShader, llvmpipe, the WebKitGTK comp-mode-off fallback) stay on
// the DOM renderer, because a software canvas is SLOWER than DOM, not faster.

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

// Known software-rasterizer fingerprints, as they appear in the WebGL
// UNMASKED_RENDERER_WEBGL string when the browser falls back to CPU rendering.
const SOFTWARE_FINGERPRINTS = [
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "software",
  "basic render driver", // Microsoft Basic Render Driver (WARP)
  "microsoft basic",
];

/** Does this UNMASKED_RENDERER string name a software rasterizer? Case-insensitive
 *  substring match against the known fingerprints. A null/empty renderer string is
 *  treated as NOT-known-software (we can't prove it's software, so a real WebGL2
 *  context still counts) — the caller decides the conservative default elsewhere. */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  if (!renderer) return false;
  const r = renderer.toLowerCase();
  return SOFTWARE_FINGERPRINTS.some((f) => r.includes(f));
}

/** Pure decision: given the WebGPU adapter result (or null when none) and the
 *  WebGL2 renderer string (or null when no WebGL2 context), pick the tier.
 *  A WebGPU adapter that IS fallback is ignored — Chrome can return a
 *  SwiftShader-backed `isFallbackAdapter` adapter on GPU-less machines, and
 *  lighting up the canvas there would violate "never choose software over DOM". */
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

/** Try to get a WebGL2 context and read its UNMASKED_RENDERER. Returns the
 *  renderer string, "" when a context exists but the debug-info extension is
 *  unavailable (real context, unknown name → treated as non-software), or null
 *  when no WebGL2 context could be created at all. */
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
    // Context exists but the renderer name is masked — count it as a real context
    // with an unknown (non-software) renderer.
    return "";
  } catch {
    return null;
  }
}

/** Probe the platform once and report what the canvas renderer may use. Async
 *  because requestAdapter() is. Never throws — any failure resolves to a DOM-safe
 *  capability. */
export async function probeGpu(): Promise<GpuCapability> {
  let webgpu: { isFallback: boolean } | null = null;
  try {
    // Structural type for navigator.gpu — the @webgpu/types lib isn't in our tsconfig.
    // We need requestAdapter()'s return AND its `isFallbackAdapter` flag (a fallback
    // adapter is software-backed, so it must NOT count as a real GPU).
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
