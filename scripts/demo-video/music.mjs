// The demo video's soundtrack, synthesized so the cut carries no licensed audio: a D major pad, bass and soft
// arpeggio at 96 BPM under a small Freeverb, written as a 48 kHz stereo WAV the length of the cut.
import fs from "node:fs";

const SR = 48000;
const BEAT = 60 / 96;
const CHORD_S = BEAT * 8;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// Dmaj9, Bm11, Gmaj7(add13), Asus2: the pad voicing, the bass root, the arpeggio's upper tones.
const CHORDS = [
  { root: 38, pad: [50, 57, 61, 64, 66], arp: [69, 73, 76, 78, 81] },
  { root: 35, pad: [47, 54, 57, 62, 64], arp: [66, 69, 71, 74, 76] },
  { root: 31, pad: [43, 50, 54, 59, 62], arp: [66, 67, 71, 74, 78] },
  { root: 33, pad: [45, 52, 57, 59, 64], arp: [64, 69, 71, 73, 76] },
];
const ARP = [0, 2, 3, 4, 3, 2, 1, 2];

// One cycle of a soft sawtooth: eight harmonics rolled off faster than 1/k.
const TABLE = 4096;
const saw = new Float32Array(TABLE + 1);
for (let i = 0; i <= TABLE; i++) {
  let v = 0;
  for (let k = 1; k <= 8; k++) v += Math.sin((2 * Math.PI * k * i) / TABLE) / (k ** 1.35);
  saw[i] = v * 0.55;
}
const wave = (phase) => {
  const x = (phase - Math.floor(phase)) * TABLE, i = x | 0, f = x - i;
  return saw[i] + (saw[i + 1] - saw[i]) * f;
};

function smoothstep(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

// Freeverb (Jezar): eight damped combs and four allpasses per channel, the right channel's delays spread by 23.
function freeverb(input, spread) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(((d + spread) * SR) / 44100));
  const alls = [556, 441, 341, 225].map((d) => Math.round(((d + spread) * SR) / 44100));
  const out = new Float32Array(input.length);
  const feedback = 0.84, damp = 0.25;
  for (const len of combs) {
    const buf = new Float32Array(len);
    let idx = 0, store = 0;
    for (let n = 0; n < input.length; n++) {
      const y = buf[idx];
      store = y * (1 - damp) + store * damp;
      buf[idx] = input[n] * 0.015 + store * feedback;
      out[n] += y;
      idx = idx + 1 === len ? 0 : idx + 1;
    }
  }
  for (const len of alls) {
    const buf = new Float32Array(len);
    let idx = 0;
    for (let n = 0; n < out.length; n++) {
      const b = buf[idx], x = out[n];
      out[n] = b - x;
      buf[idx] = x + b * 0.5;
      idx = idx + 1 === len ? 0 : idx + 1;
    }
  }
  return out;
}

export function writeMusic(seconds, file, { arpFrom = 4.2 } = {}) {
  const N = Math.ceil((seconds + 1) * SR);
  const padL = new Float32Array(N), padR = new Float32Array(N);
  const bass = new Float32Array(N);
  const arpL = new Float32Array(N), arpR = new Float32Array(N);

  // Pad: three detuned voices a note, each chord swelling in over 1.4 s and out over 1.8 s past its bar line.
  const nChords = Math.ceil(seconds / CHORD_S) + 1;
  for (let c = 0; c < nChords; c++) {
    const ch = CHORDS[c % CHORDS.length];
    const t0 = c * CHORD_S, t1 = t0 + CHORD_S;
    const s0 = Math.max(0, Math.floor((t0 - 0.2) * SR)), s1 = Math.min(N, Math.ceil((t1 + 1.8) * SR));
    ch.pad.forEach((m, j) => {
      const base = mtof(m);
      [-6, 0, 7].forEach((cents, v) => {
        const f = base * 2 ** (cents / 1200);
        const pan = 0.5 + (v - 1) * 0.28 + (j - 2) * 0.04;
        let ph = (c * 0.37 + j * 0.11 + v * 0.29) % 1;
        for (let n = s0; n < s1; n++) {
          const t = n / SR;
          const env = smoothstep((t - t0 + 0.2) / 1.4) * (1 - smoothstep((t - t1) / 1.8));
          const s = wave(ph) * env * 0.05;
          padL[n] += s * (1 - pan);
          padR[n] += s * pan;
          ph += f / SR;
        }
      });
    });
    // Bass: the root an octave up, over a quieter sub an octave below it.
    const fb = mtof(ch.root + 12);
    let ph = 0;
    for (let n = s0; n < s1; n++) {
      const t = n / SR;
      const env = smoothstep((t - t0 + 0.05) / 0.5) * (1 - smoothstep((t - t1 + 0.1) / 1.0));
      bass[n] += (Math.sin(2 * Math.PI * ph) * 0.06 + Math.sin(Math.PI * ph) * 0.03 + Math.sin(4 * Math.PI * ph) * 0.012) * env;
      ph += fb / SR;
    }
  }

  // The pad breathes through a low-pass whose cutoff drifts between about 1300 and 2500 Hz.
  for (const buf of [padL, padR]) {
    let z1 = 0, z2 = 0, a0 = 0, a1 = 0, a2 = 0, b1 = 0, b2 = 0;
    for (let n = 0; n < N; n++) {
      if (n % 64 === 0) {
        const fc = 1900 + 600 * Math.sin((2 * Math.PI * n) / SR / 13);
        const w = (2 * Math.PI * fc) / SR, q = 0.6, al = Math.sin(w) / (2 * q), cw = Math.cos(w);
        const norm = 1 + al;
        a0 = (1 - cw) / 2 / norm; a1 = (1 - cw) / norm; a2 = a0; b1 = (-2 * cw) / norm; b2 = (1 - al) / norm;
      }
      const x = buf[n], y = a0 * x + z1;
      z1 = a1 * x - b1 * y + z2;
      z2 = a2 * x - b2 * y;
      buf[n] = y;
    }
  }

  // Arpeggio: eighth notes from the chord's upper tones, a sine bell with a quick decay, panned a little each way.
  const step = BEAT / 2;
  const arpTo = seconds - 3.5;
  for (let k = 0; ; k++) {
    const t0 = arpFrom + k * step;
    if (t0 > arpTo) break;
    const ch = CHORDS[Math.floor(t0 / CHORD_S) % CHORDS.length];
    const m = ch.arp[ARP[k % ARP.length]];
    const f = mtof(m);
    const vel = (k % 2 === 0 ? 1 : 0.72) * smoothstep((t0 - arpFrom) / 3) * (1 - smoothstep((t0 - (arpTo - 3)) / 3));
    const pan = 0.5 + (k % 4 < 2 ? -0.18 : 0.18);
    const s0 = Math.floor(t0 * SR), s1 = Math.min(N, s0 + Math.floor(1.2 * SR));
    for (let n = s0; n < s1; n++) {
      const t = (n - s0) / SR;
      const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.24);
      const ph = 2 * Math.PI * f * t;
      const bell = Math.sin(ph) + 0.3 * Math.sin(2 * ph) * Math.exp(-t / 0.12) + 0.12 * Math.sin(3 * ph) * Math.exp(-t / 0.07);
      const s = bell * env * vel * 0.09;
      arpL[n] += s * (1 - pan);
      arpR[n] += s * pan;
    }
  }

  // Reverb on pad and arpeggio, then the mix, a gentle tanh ceiling, and peak normalization to -3 dBFS.
  const sendL = new Float32Array(N), sendR = new Float32Array(N);
  for (let n = 0; n < N; n++) { sendL[n] = padL[n] + arpL[n] * 1.6; sendR[n] = padR[n] + arpR[n] * 1.6; }
  const revL = freeverb(sendL, 0), revR = freeverb(sendR, 23);
  const L = new Float32Array(N), R = new Float32Array(N);
  let peak = 0, dry = 0;
  for (let n = 0; n < N; n++) {
    const l = padL[n] + arpL[n] + bass[n] + revL[n] * 0.9, r = padR[n] + arpR[n] + bass[n] + revR[n] * 0.9;
    dry = Math.max(dry, Math.abs(l), Math.abs(r));
    L[n] = Math.tanh(l);
    R[n] = Math.tanh(r);
    peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
  }
  const gain = 0.708 / (peak || 1);

  const data = Buffer.alloc(N * 4);
  for (let n = 0; n < N; n++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * gain)) * 32767), n * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * gain)) * 32767), n * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return { seconds, prePeak: dry };
}
