// [[C17]] shareImpl
// Compute from the formulation, never a transcribed table.

// log₁₀(p/mmHg) = A − B/(C + T°C), Lange's-handbook coefficient form; `bp` is the normal boiling point each triple must reproduce.

export type AntoineOp =
  | "water" | "ethanol" | "methanol" | "isopropanol"
  | "acetone" | "benzene" | "toluene" | "hexane" | "ammonia";

export interface AntoineMeta { label: string; A: number; B: number; C: number; bp: number }

export const ANTOINE: Record<AntoineOp, AntoineMeta> = {
  water:       { label: "Water",       A: 8.07131, B: 1730.63,  C: 233.426, bp: 100.0 },
  ethanol:     { label: "Ethanol",     A: 8.20417, B: 1642.89,  C: 230.3,   bp: 78.37 },
  methanol:    { label: "Methanol",    A: 8.08097, B: 1582.271, C: 239.726, bp: 64.7 },
  isopropanol: { label: "Isopropanol", A: 8.11778, B: 1580.92,  C: 219.61,  bp: 82.3 },
  acetone:     { label: "Acetone",     A: 7.11714, B: 1210.595, C: 229.664, bp: 56.05 },
  benzene:     { label: "Benzene",     A: 6.90565, B: 1211.033, C: 220.79,  bp: 80.1 },
  toluene:     { label: "Toluene",     A: 6.95464, B: 1344.8,   C: 219.48,  bp: 110.6 },
  hexane:      { label: "n-Hexane",    A: 6.87601, B: 1171.17,  C: 224.41,  bp: 68.7 },
  ammonia:     { label: "Ammonia",     A: 7.3605,  B: 926.132,  C: 240.17,  bp: -33.34 },
};

