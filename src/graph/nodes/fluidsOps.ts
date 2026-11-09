// [[C17]] shareImpl

// Absolute roughness ε in mm.

export const PIPE_ROUGHNESS: Array<{ id: string; label: string; mm: number }> = [
  { id: "pvc",        label: "PVC / plastic / drawn tubing", mm: 0.0015 },
  { id: "copper",     label: "Copper / brass (drawn)",       mm: 0.0015 },
  { id: "stainless",  label: "Stainless steel",              mm: 0.015 },
  { id: "steel",      label: "Commercial steel",             mm: 0.045 },
  { id: "wrought",    label: "Wrought iron",                 mm: 0.046 },
  { id: "asphalted",  label: "Asphalted cast iron",          mm: 0.12 },
  { id: "galvanized", label: "Galvanized iron",              mm: 0.15 },
  { id: "castiron",   label: "Cast iron",                    mm: 0.26 },
  { id: "concrete",   label: "Concrete (smooth)",            mm: 0.3 },
  { id: "wood",       label: "Wood stave",                   mm: 0.5 },
  { id: "concreteR",  label: "Concrete (rough)",             mm: 3 },
  { id: "riveted",    label: "Riveted steel",                mm: 3 },
  { id: "corrugated", label: "Corrugated metal",             mm: 45 },
];
