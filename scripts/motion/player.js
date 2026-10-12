// [[C121]]
// The three.js player: builds a capture's pieces (export.py → pieces.json) as flat meshes in CSS paint order
// and renders frames of a clip. Units are flow px (x right, y up = -flow y, z toward the camera). Each output
// frame averages `samples` renders with the camera jittered across its aperture and time across the shutter,
// which is real depth of field and motion blur (and anti-aliasing); light above 1.0 (cable pulses) blooms.
// Display-referred like the browser: colors are their sRGB values, nothing is converted, so translucent
// strokes blend on encoded values as Chrome blends them.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

THREE.ColorManagement.enabled = false;
const SENSOR_W = 36; // mm, horizontal, as a 35 mm still camera

export async function createPlayer({ capUrl, width, height }) {
  const data = await (await fetch(`${capUrl}/pieces.json`)).json();
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const rgb = (c) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);

  // ---- canvas: its color with a dot of `radius` on every multiple of `gap` (CanvasBacking.tsx) ----
  const bg = data.background;
  const canvas = new THREE.Mesh(
    new THREE.PlaneGeometry(400000, 400000),
    new THREE.ShaderMaterial({
      uniforms: { base: { value: rgb(bg.color) }, dot: { value: rgb(bg.dot) }, gap: { value: bg.gap }, radius: { value: bg.radius } },
      vertexShader: "varying vec2 p; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); p = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: `uniform vec3 base, dot; uniform float gap, radius; varying vec2 p;
        void main(){ vec2 q = p - gap * floor(p / gap + 0.5); float d = length(q); float aa = max(fwidth(d), 1e-4);
          float k = 1.0 - smoothstep(radius - aa * 0.5, radius + aa * 0.5, d); gl_FragColor = vec4(mix(base, dot, k), 1.0); }`,
      depthTest: false, depthWrite: false, transparent: true,
    }),
  );
  canvas.renderOrder = -1e6;
  scene.add(canvas);

  // ---- cables: ribbons whose `reveal` (0..1 from the source) and hot `pulse` head a clip drives ----
  const cables = data.cables.map((c, i) => {
    const g = new THREE.BufferGeometry();
    const v = new Float32Array((c.verts.length / 2) * 3);
    for (let k = 0; k < c.verts.length / 2; k++) { v[3 * k] = c.verts[2 * k]; v[3 * k + 1] = -c.verts[2 * k + 1]; }
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.setAttribute("u", new THREE.BufferAttribute(new Float32Array(c.u), 1));
    g.setIndex(c.faces);
    const m = new THREE.ShaderMaterial({
      uniforms: { color: { value: rgb(c.color) }, alpha: { value: c.color[3] }, reveal: { value: 1 }, pulse: { value: -1 }, pulseWidth: { value: 0.05 }, glow: { value: new THREE.Color(1.0, 0.86, 0.45) }, gain: { value: 4 } },
      vertexShader: "attribute float u; varying float vu; void main(){ vu = u; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 color, glow; uniform float alpha, reveal, pulse, pulseWidth, gain; varying float vu;
        void main(){ float shown = step(vu, reveal); float d = (vu - pulse) / pulseWidth; float head = exp(-d * d) * shown;
          vec3 c = color * shown * alpha + glow * head * gain; float a = max(shown * alpha, head);
          gl_FragColor = vec4(c / max(a, 1e-4), a); }`,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -1000 + i;
    mesh.userData = c;
    scene.add(mesh);
    return mesh;
  });

  // ---- cards: a group at each card's center; every piece a mesh at its place, in paint order ----
  const cards = {};
  data.cards.forEach((c, ci) => {
    const grp = new THREE.Group();
    const cx = c.box.x + c.box.w / 2, cy = c.box.y + c.box.h / 2;
    grp.position.set(cx, -cy, 0);
    grp.userData = { ...c, index: ci, pieces: [] };
    scene.add(grp);
    cards[c.title] = grp;
  });
  const mats = new Map();
  const matFor = (col) => {
    const key = col.join(",");
    if (!mats.has(key)) mats.set(key, new THREE.MeshBasicMaterial({ color: rgb(col), opacity: col[3], transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    return mats.get(key);
  };
  const pieces = data.pieces.map((p) => {
    const grp = cards[p.card];
    const g = new THREE.BufferGeometry();
    const v = new Float32Array((p.verts.length / 2) * 3);
    for (let k = 0; k < p.verts.length / 2; k++) { v[3 * k] = p.verts[2 * k]; v[3 * k + 1] = -p.verts[2 * k + 1]; }
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.setIndex(p.faces);
    const mesh = new THREE.Mesh(g, matFor(p.color));
    const b = grp.userData.box;
    const rest = new THREE.Vector3(p.center[0] - (b.x + b.w / 2), -(p.center[1] - (b.y + b.h / 2)), 0);
    mesh.position.copy(rest);
    mesh.renderOrder = grp.userData.index * 10000 + p.order;
    mesh.userData = { ...p, rest };
    grp.add(mesh);
    grp.userData.pieces.push(mesh);
    return mesh;
  });

  // ---- cameras and the accumulation buffer ----
  const camera = new THREE.PerspectiveCamera(30, width / height, 1, 1e7);
  camera.up.set(0, 1, 0);
  // no MSAA: the per-sample sub-pixel jitter already anti-aliases, and software GL pays 4× for it
  const rtScene = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
  const rtAcc = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { src: { value: rtScene.texture }, weight: { value: 1 } },
    vertexShader: "varying vec2 uv0; void main(){ uv0 = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform sampler2D src; uniform float weight; varying vec2 uv0; void main(){ gl_FragColor = texture2D(src, uv0) * weight; }",
    // plain sum (one + one): the built-in additive blend also multiplies by source alpha
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    depthTest: false, depthWrite: false, transparent: true,
  }));
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType }));
  composer.addPass(new TexturePass(rtAcc.texture));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.8, 0.45, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // A camera shot: position, look-at, lens (mm), f-stop. Jitter moves the eye across the aperture disk while
  // keeping the focus point fixed, and shifts the image by a sub-pixel for anti-aliasing.
  const look = new THREE.Vector3();
  const place = (shot, jitter) => {
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((SENSOR_W * height / width) / 2 / shot.lens));
    const eye = shot.eye.clone();
    look.copy(shot.look);
    if (jitter && shot.fstop) {
      // aperture radius in world px: lens/fstop mm wide, at one flow px per centimetre (the Blender-era scale)
      const r = (shot.lens / shot.fstop / 2) * 0.1;
      const dir = look.clone().sub(eye).normalize();
      const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      const upv = new THREE.Vector3().crossVectors(right, dir).normalize();
      eye.addScaledVector(right, jitter.ax * r).addScaledVector(upv, jitter.ay * r);
    }
    camera.position.copy(eye);
    camera.lookAt(look);
    if (jitter) camera.setViewOffset(width, height, jitter.px, jitter.py, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };

  // Halton points: evenly spread jitter for time, aperture and pixel.
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

  /** Render one output frame: `pose(t)` sets the scene for time t and returns the camera shot. */
  function frame(pose, t, { samples = 16, shutter = 0.5 / 60, bloomOn = true } = {}) {
    renderer.setRenderTarget(rtAcc);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    quad.material.uniforms.weight.value = 1 / samples;
    for (let i = 0; i < samples; i++) {
      const ts = t + (samples > 1 ? (halton(i + 1, 2) - 0.5) * shutter : 0);
      const shot = pose(ts);
      const a = 2 * Math.PI * halton(i + 1, 3), rr = Math.sqrt(halton(i + 1, 5));
      place(shot, samples > 1 ? { ax: Math.cos(a) * rr, ay: Math.sin(a) * rr, px: halton(i + 1, 7) - 0.5, py: halton(i + 1, 11) - 0.5 } : null);
      renderer.setRenderTarget(rtScene);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(rtAcc);
      renderer.autoClear = false; // add to the sum, don't wipe it
      renderer.render(quadScene, quadCam);
      renderer.autoClear = true;
    }
    bloom.enabled = bloomOn;
    renderer.setRenderTarget(null);
    composer.render();
  }

  /** An orthographic, effect-free view of flow box b at `scale` px per flow px: the rest check's camera. */
  function flat(pose, t, b, scale) {
    const w = Math.round(b.w * scale), h = Math.round(b.h * scale);
    renderer.setSize(w, h);
    const cam = new THREE.OrthographicCamera(b.x, b.x + b.w, -b.y, -(b.y + b.h), 0.1, 1e6);
    cam.position.set(0, 0, 5000);
    pose(t);
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    let acc = null;
    const N = 8;
    for (let i = 0; i < N; i++) {
      cam.setViewOffset(w, h, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, w, h);
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, cam);
      const px = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
      acc ??= new Float32Array(px.length);
      for (let k = 0; k < px.length; k++) acc[k] += px[k] / N;
    }
    renderer.setRenderTarget(null);
    // flip rows: GL reads bottom-up
    const out = new Uint8ClampedArray(acc.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) out[y * w * 4 + x] = acc[(h - 1 - y) * w * 4 + x];
    return { w, h, rgba: out };
  }

  return { THREE, data, scene, cards, pieces, cables, frame, flat, renderer };
}
