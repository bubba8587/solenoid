// Solenoid's palette system, lifted whole (src/graph/palette.ts, DESIGN.md § Colors): nine palettes, each
// a set of twelve color slots and a thirteen-key neutral ramp per theme, the derived chrome, the light-theme
// accent step and the ink rule for a filled accent. The tables are copied as data so the tool stays isolated;
// Default's ramp is also written into styles.css so the page is right before any script runs.

export const SLOTS = {Default:{gray:"#8a8f98",amber:"#d9742b",blue:"#3173e0",teal:"#4fc89a",purple:"#c05dd1",green:"#00b862",gold:"#f5b914",lime:"#c8e040",pink:"#de7cb0",sky:"#56b4e9",vermilion:"#e0473a",violet:"#7b64ed"},Muted:{gray:"#8a8f98",amber:"#ba8551",blue:"#6991d4",teal:"#65a2ac",purple:"#a772bb",green:"#27a58a",gold:"#cba743",lime:"#b3c25f",pink:"#c988aa",sky:"#6faacc",vermilion:"#c87a5d",violet:"#9479d1"},"Colorblind-safe":{gray:"#999999",gold:"#e69f00",lime:"#f0e442",pink:"#cc79a7",sky:"#56b4e9",vermilion:"#d55e00",violet:"#0072b2",green:"#009e73",amber:"#e69f00",blue:"#0072b2",teal:"#56b4e9",purple:"#cc79a7"},Solarized:{gray:"#93a1a1",vermilion:"#dc322f",amber:"#cb4b16",gold:"#d9a521",lime:"#859900",green:"#5e9e4a",teal:"#2aa198",sky:"#5fa8d8",blue:"#268bd2",violet:"#6c71c4",purple:"#9156a8",pink:"#d33682"},Equinox:{gold:"#c7c7c7",green:"#828282",amber:"#777777",blue:"#4d4d4d",lime:"#dedede",purple:"#6d6d6d",gray:"#707070",vermilion:"#5f5f5f",violet:"#585858",pink:"#8e8e8e",sky:"#9b9b9b",teal:"#a4a4a4"},Orchard:{gold:"#d49d13",green:"#66910b",amber:"#be7516",blue:"#4c7592",lime:"#b8d532",purple:"#976589",gray:"#8a8367",vermilion:"#b44921",violet:"#786f9d",pink:"#ce5d76",sky:"#629ca8",teal:"#539076"},Blueprint:{gold:"#dfbb67",green:"#60bf96",amber:"#d68f64",blue:"#4f8fd0",lime:"#b4d073",purple:"#ab91df",gray:"#99a8bf",vermilion:"#d76960",violet:"#8690e0",pink:"#dc94b0",sky:"#7fc5eb",teal:"#52bbba"},Neon:{gray:"#8a8f98",violet:"#715af9",blue:"#137bf4",vermilion:"#f44116",purple:"#ef25ef",pink:"#f330b4",amber:"#f28711",sky:"#20dff7",gold:"#fcd507",green:"#00e672",teal:"#21ecbd",lime:"#d3f418"},"Dawn and Dusk":{gold:"#e9ba7f",green:"#73a980",amber:"#c57e65",blue:"#5f74ba",lime:"#d5d791",purple:"#b46fb9",gray:"#8f8e96",vermilion:"#c56261",violet:"#846ec4",pink:"#ce88ae",sky:"#8bacd3",teal:"#8ebaa7"}};

export const CHROME = {Default:{dark:{appBg:"#141414",canvasBg:"#0b0b0b",canvasDot:"#2a2a2a",surface:"#1e1e1e",surfaceSunken:"#141414",surfaceRaised:"#262626",border:"#2d2d2d",borderStrong:"#3a3a3a",borderSubtle:"#2a2a2a",text:"#e8e8e8",textBright:"#f3f4f5",textDim:"#9aa0a6",textMuted:"#80868e"},light:{appBg:"#f4f5f7",canvasBg:"#eef1f5",canvasDot:"#d3d9e1",surface:"#fbfcfd",surfaceSunken:"#ffffff",surfaceRaised:"#eef1f5",border:"#ccd2da",borderStrong:"#b2bac4",borderSubtle:"#dfe3e9",text:"#1b1e23",textBright:"#0d0f12",textDim:"#5b636b",textMuted:"#6a717b"}},Muted:{dark:{appBg:"#1b1c20",canvasBg:"#131417",canvasDot:"#303338",surface:"#232529",surfaceSunken:"#1a1b1f",surfaceRaised:"#2b2e33",border:"#34373d",borderStrong:"#43474e",borderSubtle:"#2d3035",text:"#dfe1e5",textBright:"#f0f1f3",textDim:"#a2a7ae",textMuted:"#8b9098"},light:{appBg:"#f1f2f5",canvasBg:"#eceef1",canvasDot:"#d6dae0",surface:"#fafbfc",surfaceSunken:"#ffffff",surfaceRaised:"#eceef1",border:"#cdd2d9",borderStrong:"#b3b9c2",borderSubtle:"#dfe2e7",text:"#24272c",textBright:"#14161a",textDim:"#5d626a",textMuted:"#6b7079"}},"Colorblind-safe":{dark:{appBg:"#131313",canvasBg:"#080808",canvasDot:"#2e2e2e",surface:"#1c1c1c",surfaceSunken:"#121212",surfaceRaised:"#292929",border:"#333333",borderStrong:"#4a4a4a",borderSubtle:"#272727",text:"#f2f2f2",textBright:"#ffffff",textDim:"#ababab",textMuted:"#949494"},light:{appBg:"#f0f0f0",canvasBg:"#e8e8e8",canvasDot:"#cfcfcf",surface:"#fcfcfc",surfaceSunken:"#ffffff",surfaceRaised:"#ebebeb",border:"#c2c2c2",borderStrong:"#a0a0a0",borderSubtle:"#dadada",text:"#121212",textBright:"#000000",textDim:"#4d4d4d",textMuted:"#5e5e5e"}},Solarized:{dark:{appBg:"#03303b",canvasBg:"#001c24",canvasDot:"#092a32",surface:"#073642",surfaceSunken:"#03303b",surfaceRaised:"#113d48",border:"#234a54",borderStrong:"#34555e",borderSubtle:"#17414c",text:"#93a1a1",textBright:"#eee8d5",textDim:"#839496",textMuted:"#657b83"},light:{appBg:"#e7e2d1",canvasBg:"#ece6d3",canvasDot:"#d8d2be",surface:"#fdf6e3",surfaceSunken:"#fffcf0",surfaceRaised:"#eee8d5",border:"#d1d1c4",borderStrong:"#c1c5bb",borderSubtle:"#dedbcc",text:"#586e75",textBright:"#073642",textDim:"#657b83",textMuted:"#839496"}},Equinox:{dark:{appBg:"#0e0e0e",canvasBg:"#080808",canvasDot:"#2a2a2a",surface:"#151515",surfaceSunken:"#0e0e0e",surfaceRaised:"#1b1b1b",border:"#4d4d4d",borderStrong:"#585858",borderSubtle:"#474747",text:"#efefef",textBright:"#f7f7f7",textDim:"#bdbdbd",textMuted:"#ababab"},light:{appBg:"#f7f7f7",canvasBg:"#f2f2f2",canvasDot:"#d5d5d5",surface:"#fcfcfc",surfaceSunken:"#ffffff",surfaceRaised:"#f2f2f2",border:"#b1b1b1",borderStrong:"#9b9b9b",borderSubtle:"#c0c0c0",text:"#151515",textBright:"#0b0b0b",textDim:"#444444",textMuted:"#4e4e4e"}},Orchard:{dark:{appBg:"#17160c",canvasBg:"#080703",canvasDot:"#322f21",surface:"#1f1d12",surfaceSunken:"#17160c",surfaceRaised:"#2a2718",border:"#363320",borderStrong:"#4c472c",borderSubtle:"#2b2818",text:"#f0ead8",textBright:"#fdf8ea",textDim:"#aaa287",textMuted:"#857d63"},light:{appBg:"#ede7d7",canvasBg:"#f1ece0",canvasDot:"#dfd7c4",surface:"#fffdf7",surfaceSunken:"#ffffff",surfaceRaised:"#ede7d7",border:"#cdc3a7",borderStrong:"#b8ab87",borderSubtle:"#e2dac6",text:"#2b2517",textBright:"#191308",textDim:"#6d6450",textMuted:"#8b8269"}},Blueprint:{dark:{appBg:"#10273f",canvasBg:"#07172a",canvasDot:"#1e3b57",surface:"#16304b",surfaceSunken:"#102843",surfaceRaised:"#1e3d5c",border:"#274a6d",borderStrong:"#375f85",borderSubtle:"#1f4062",text:"#e3ecf5",textBright:"#ffffff",textDim:"#a7bdd4",textMuted:"#8ba4bf"},light:{appBg:"#eff2f6",canvasBg:"#e7ecf2",canvasDot:"#c2d1e1",surface:"#fbfcfe",surfaceSunken:"#ffffff",surfaceRaised:"#e6ecf3",border:"#c2ced8",borderStrong:"#a4b4c6",borderSubtle:"#dae1ea",text:"#16283c",textBright:"#0a1826",textDim:"#4e6379",textMuted:"#5d7288"}},Neon:{dark:{appBg:"#0a0a0a",canvasBg:"#060606",canvasDot:"#2a2a2a",surface:"#0f0f0f",surfaceSunken:"#0a0a0a",surfaceRaised:"#131313",border:"#626262",borderStrong:"#6b6b6b",borderSubtle:"#5f5f5f",text:"#f4f4f4",textBright:"#f9fafa",textDim:"#cdd0d3",textMuted:"#c0c3c7"},light:{appBg:"#fafafb",canvasBg:"#f7f8fa",canvasDot:"#d3d9e1",surface:"#fdfefe",surfaceSunken:"#ffffff",surfaceRaised:"#f7f8fa",border:"#999ea4",borderStrong:"#868c93",borderSubtle:"#a7aaaf",text:"#0e0f12",textBright:"#070809",textDim:"#2e3236",textMuted:"#35393e"}},"Dawn and Dusk":{dark:{appBg:"#2c1c27",canvasBg:"#1d1019",canvasDot:"#41323c",surface:"#372731",surfaceSunken:"#2c1c27",surfaceRaised:"#402f3a",border:"#473641",borderStrong:"#55444f",borderSubtle:"#44333e",text:"#ede9d6",textBright:"#f8f4e2",textDim:"#a3a08e",textMuted:"#898675"},light:{appBg:"#fcf3ea",canvasBg:"#f2e9e1",canvasDot:"#dad1c8",surface:"#fffbf7",surfaceSunken:"#ffffff",surfaceRaised:"#f8efe6",border:"#d9d0c7",borderStrong:"#c0b8ae",borderSubtle:"#eae1d8",text:"#261922",textBright:"#160a12",textDim:"#6c5d67",textMuted:"#7b6b75"}}};

export const PALETTE_NAMES = Object.keys(SLOTS);

const RAMP_VARS = {
  appBg: '--app-bg', canvasBg: '--canvas-bg', canvasDot: '--canvas-dot',
  surface: '--surface', surfaceSunken: '--surface-sunken', surfaceRaised: '--surface-raised',
  border: '--border', borderStrong: '--border-strong', borderSubtle: '--border-subtle',
  text: '--text', textBright: '--text-bright', textDim: '--text-dim', textMuted: '--text-muted',
};

const parse = (hex) => (/^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null);

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((t) => Math.round((t + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function relLum(hex) {
  const [r, g, b] = parse(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The light theme draws every slot a step darker in HSV value, so it holds up on a pale card.
export function themeAccent(hex, mode) {
  const t = parse(hex);
  if (mode !== 'light' || !t) return hex;
  const [h, s, v] = rgbToHsv(...t);
  return hsvToHex(h, s, Math.max(0, v - 0.045));
}

// White on a filled color wherever white clears 3:1, as Android Chrome decides for its tinted toolbar.
export function contrastInk(hex) {
  if (!parse(hex)) return '#fff';
  return 1.05 / (relLum(hex) + 0.05) >= 3 ? '#fff' : '#1a1a1a';
}

function mixHex(a, b, t) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return a;
  return `#${[0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join('')}`;
}

function rgba(hex, alpha) {
  const t = parse(hex);
  return t ? `rgba(${t[0]},${t[1]},${t[2]},${alpha})` : `rgba(0,0,0,${alpha})`;
}

export function themeMode() {
  const set = document.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Every color var the page reads, for one palette in one theme: the ramp, the chrome derived from it by
// Solenoid's fixed mixes, each slot themed with its ink, and the roles (accent, status) that name slots.
export function paletteVars(name, mode) {
  const ramp = { ...CHROME.Default[mode], ...(CHROME[name]?.[mode] || {}) };
  const slots = SLOTS[name] || SLOTS.Default;
  const out = {};
  for (const [key, cssVar] of Object.entries(RAMP_VARS)) out[cssVar] = ramp[key];
  out['--overlay-border'] = mixHex(ramp.borderStrong, ramp.text, 0.08);
  out['--btn-hover'] = mixHex(ramp.surfaceSunken, ramp.text, 0.08);
  const shade = mode === 'light' ? ramp.text : '#000000';
  out['--shadow-pop'] = `0 4px 14px ${rgba(shade, mode === 'light' ? 0.07 : 0.2)}`;
  out['--overlay-shadow'] = `0 4px 14px ${rgba(shade, mode === 'light' ? 0.1 : 0.3)}, 0 1px 4px ${rgba(shade, mode === 'light' ? 0.06 : 0.2)}`;
  for (const [slot, hex] of Object.entries(slots)) {
    const themed = themeAccent(hex, mode);
    out[`--slot-${slot}`] = themed;
    out[`--slot-${slot}-ink`] = contrastInk(themed);
  }
  out['--accent-ink'] = contrastInk(themeAccent(slots.gold, mode));
  return out;
}

export function applyPalette(name) {
  const root = document.documentElement;
  const vars = paletteVars(name, themeMode());
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.palette = name;
}
