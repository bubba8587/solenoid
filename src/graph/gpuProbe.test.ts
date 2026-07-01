import { describe, it, expect } from "vitest";
import { isSoftwareRenderer, classifyCapability } from "./gpuProbe";

describe("isSoftwareRenderer", () => {
  it("flags known software fingerprints (case-insensitive)", () => {
    const software = [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
      "Google SwiftShader",
      "llvmpipe (LLVM 15.0.6, 256 bits)",
      "softpipe",
      "Microsoft Basic Render Driver",
      "Some Software Rasterizer",
    ];
    for (const r of software) {
      expect(isSoftwareRenderer(r), r).toBe(true);
    }
  });

  it("does not flag real hardware renderers", () => {
    const hardware = [
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)",
      "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)",
      "Apple M2 Pro",
      "AMD Radeon Pro 5500M OpenGL Engine",
      "Mali-G78",
    ];
    for (const r of hardware) {
      expect(isSoftwareRenderer(r), r).toBe(false);
    }
  });

  it("treats null/empty/undefined as not-known-software", () => {
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
    expect(isSoftwareRenderer("")).toBe(false);
  });
});

describe("classifyCapability", () => {
  it("real (non-fallback) WebGPU adapter wins → webgpu, canvas usable", () => {
    const cap = classifyCapability({ isFallback: false }, "llvmpipe"); // even a software GL string
    expect(cap.tier).toBe("webgpu");
    expect(cap.canUseCanvas).toBe(true);
    expect(cap.software).toBe(false);
  });

  it("FALLBACK WebGPU adapter is ignored — falls through to WebGL2", () => {
    // Software WebGPU (SwiftShader) + software WebGL2 → none, not canvas.
    const sw = classifyCapability({ isFallback: true }, "Google SwiftShader");
    expect(sw.tier).toBe("none");
    expect(sw.canUseCanvas).toBe(false);
    // Software WebGPU but a real WebGL2 → webgl2 (the hardware path still wins).
    const hw = classifyCapability({ isFallback: true }, "Apple M2 Pro");
    expect(hw.tier).toBe("webgl2");
    expect(hw.canUseCanvas).toBe(true);
  });

  it("no WebGPU, real WebGL2 → webgl2, canvas usable", () => {
    const cap = classifyCapability(null, "Apple M2 Pro");
    expect(cap.tier).toBe("webgl2");
    expect(cap.canUseCanvas).toBe(true);
    expect(cap.software).toBe(false);
    expect(cap.renderer).toBe("Apple M2 Pro");
  });

  it("no WebGPU, masked-but-real WebGL2 (empty string) → webgl2 usable", () => {
    const cap = classifyCapability(null, "");
    expect(cap.tier).toBe("webgl2");
    expect(cap.canUseCanvas).toBe(true);
  });

  it("SOFTWARE WebGL2 → none (MUST route to DOM), not canvas", () => {
    const cap = classifyCapability(null, "Google SwiftShader");
    expect(cap.tier).toBe("none");
    expect(cap.canUseCanvas).toBe(false);
    expect(cap.software).toBe(true);
  });

  it("no context at all → none", () => {
    const cap = classifyCapability(null, null);
    expect(cap.tier).toBe("none");
    expect(cap.canUseCanvas).toBe(false);
    expect(cap.renderer).toBe(null);
  });
});
