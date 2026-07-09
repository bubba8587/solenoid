// Health & Fitness — the classic body/energy/cardio formulas behind a whole
// genre of calculator sites: BMI, body surface area, BMR and TDEE, body-fat
// estimates, heart-rate zones, and the standard clinical estimates. Metric
// inputs throughout (kg, cm, years); wire a Convert node from imperial.
// Sex-specific equations ship as two presets (the constants differ; a locked
// formula stays reliable instead of hiding a ±sign input).

import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";

export const HEALTH_BODY: FormulaPackEntry[] = [
  { type: "hf-bmi", label: "BMI", expr: "w/h^2",
    description: "Body mass index: weight w (kg) ÷ height h (m) squared. 18.5–25 is the WHO normal range.",
    keywords: "body mass index" },
  { type: "hf-bsa-mosteller", label: "Body Surface Area (Mosteller)", expr: "SQRT(w*hcm/3600)",
    description: "BSA in m² from weight w (kg) and height hcm (cm)   (√(w·h/3600) — the dosing standard)",
    keywords: "bsa dosing" },
  { type: "hf-bsa-dubois", label: "Body Surface Area (Du Bois)", expr: "0.007184*w^0.425*hcm^0.725",
    description: "BSA in m² from weight w (kg) and height hcm (cm) — the 1916 Du Bois & Du Bois formula",
    keywords: "bsa" },
  { type: "hf-ibw-devine-m", label: "Ideal Body Weight (Men, Devine)", expr: "50+2.3*(hcm/2.54-60)",
    description: "Devine ideal weight (kg) for men from height hcm (cm): 50 kg + 2.3 kg per inch over 5 ft" },
  { type: "hf-ibw-devine-w", label: "Ideal Body Weight (Women, Devine)", expr: "45.5+2.3*(hcm/2.54-60)",
    description: "Devine ideal weight (kg) for women from height hcm (cm): 45.5 kg + 2.3 kg per inch over 5 ft" },
];

export const HEALTH_COMPOSITION: FormulaPackEntry[] = [
  { type: "hf-bodyfat-deurenberg-m", label: "Body Fat % (Men, Deurenberg)", expr: "1.2*bmi+0.23*age-16.2",
    description: "Body-fat % for men from BMI and age (Deurenberg 1991: 1.2·BMI + 0.23·age − 10.8·1 − 5.4)" },
  { type: "hf-bodyfat-deurenberg-w", label: "Body Fat % (Women, Deurenberg)", expr: "1.2*bmi+0.23*age-5.4",
    description: "Body-fat % for women from BMI and age (Deurenberg 1991: 1.2·BMI + 0.23·age − 5.4)" },
  { type: "hf-bodyfat-navy-m", label: "Body Fat % (Men, US Navy)", expr: "495/(1.0324-0.19077*LOG10(waist-neck)+0.15456*LOG10(hcm))-450",
    description: "US Navy circumference method for men: waist and neck girth, height hcm — all in cm",
    keywords: "tape measure circumference" },
  { type: "hf-bodyfat-navy-w", label: "Body Fat % (Women, US Navy)", expr: "495/(1.29579-0.35004*LOG10(waist+hip-neck)+0.221*LOG10(hcm))-450",
    description: "US Navy circumference method for women: waist, hip and neck girth, height hcm — all in cm",
    keywords: "tape measure circumference" },
];

export const HEALTH_ENERGY: FormulaPackEntry[] = [
  { type: "hf-bmr-mifflin-m", label: "BMR (Men, Mifflin-St Jeor)", expr: "10*w+6.25*hcm-5*age+5",
    description: "Resting calories/day for men: weight w (kg), height hcm (cm), age (years) — the current ADA standard",
    keywords: "basal metabolic rate calories" },
  { type: "hf-bmr-mifflin-w", label: "BMR (Women, Mifflin-St Jeor)", expr: "10*w+6.25*hcm-5*age-161",
    description: "Resting calories/day for women: weight w (kg), height hcm (cm), age (years) — the current ADA standard",
    keywords: "basal metabolic rate calories" },
  { type: "hf-bmr-harris-m", label: "BMR (Men, Harris-Benedict)", expr: "88.362+13.397*w+4.799*hcm-5.677*age",
    description: "Resting calories/day for men — the revised (1984) Harris-Benedict equation",
    keywords: "basal metabolic rate" },
  { type: "hf-bmr-harris-w", label: "BMR (Women, Harris-Benedict)", expr: "447.593+9.247*w+3.098*hcm-4.33*age",
    description: "Resting calories/day for women — the revised (1984) Harris-Benedict equation",
    keywords: "basal metabolic rate" },
  { type: "hf-tdee", label: "TDEE", expr: "bmr*activity",
    description: "Total daily energy: BMR × activity factor (1.2 sedentary · 1.375 light · 1.55 moderate · 1.725 hard · 1.9 athlete)",
    keywords: "total daily energy expenditure calories maintenance" },
  { type: "hf-calories-mets", label: "Calories Burned (METs)", expr: "met*w*hrs",
    description: "kcal burned: activity MET value × weight w (kg) × duration hrs (running ≈ 9.8, cycling ≈ 7.5, walking ≈ 3.5)",
    keywords: "exercise energy" },
];

export const HEALTH_CARDIO: FormulaPackEntry[] = [
  { type: "hf-maxhr-classic", label: "Max Heart Rate (220 − age)", expr: "220-age",
    description: "The traditional max-HR estimate — simple but drifts high for older ages; see the Tanaka preset" },
  { type: "hf-maxhr-tanaka", label: "Max Heart Rate (Tanaka)", expr: "208-0.7*age",
    description: "Tanaka 2001 max-HR estimate (208 − 0.7·age) — the better-validated regression" },
  { type: "hf-karvonen", label: "Target Heart Rate (Karvonen)", expr: "(hrmax-hrrest)*intensity+hrrest",
    description: "Training-zone HR from max and resting HR at an intensity fraction (0.5–0.85)   (HRR method)",
    keywords: "heart rate reserve zone training" },
  { type: "hf-vo2max-cooper", label: "VO₂max (Cooper Test)", expr: "(d-504.9)/44.73",
    description: "Aerobic capacity (ml/kg/min) from the 12-minute run distance d in metres",
    keywords: "aerobic fitness running" },
];

export const HEALTH_CLINICAL: FormulaPackEntry[] = [
  { type: "hf-crcl-cockcroft-m", label: "Creatinine Clearance (Men)", expr: "(140-age)*w/(72*scr)",
    description: "Cockcroft-Gault estimate (ml/min): age, weight w (kg), serum creatinine scr (mg/dL)",
    keywords: "kidney renal gfr" },
  { type: "hf-crcl-cockcroft-w", label: "Creatinine Clearance (Women)", expr: "0.85*(140-age)*w/(72*scr)",
    description: "Cockcroft-Gault estimate for women (ml/min): the male formula × 0.85",
    keywords: "kidney renal gfr" },
];

export const HEALTH_FORMULAS: FormulaPackEntry[] = [
  ...HEALTH_BODY, ...HEALTH_COMPOSITION, ...HEALTH_ENERGY, ...HEALTH_CARDIO, ...HEALTH_CLINICAL,
];

export const HEALTH_PACK: Pack = {
  id: "health",
  name: "Health & Fitness",
  description: "Body and fitness formulas: BMI, body surface area, BMR/TDEE, body-fat estimates (Deurenberg, US Navy), heart-rate zones, VO₂max, ideal body weight, creatinine clearance. Metric inputs; estimates, not medical advice.",
  builtin: true,
  defaultActive: false,
  nodes: [
    ...placeFormulas(["Packs", "Health & Fitness"], HEALTH_BODY),
    ...placeFormulas(["Packs", "Health & Fitness", "Body Composition"], HEALTH_COMPOSITION),
    ...placeFormulas(["Packs", "Health & Fitness", "Energy & Metabolism"], HEALTH_ENERGY),
    ...placeFormulas(["Packs", "Health & Fitness", "Heart & Cardio"], HEALTH_CARDIO),
    ...placeFormulas(["Packs", "Health & Fitness", "Clinical"], HEALTH_CLINICAL),
  ],
  units: [
    { id: "kcal", label: " kcal", group: "health", groupLabel: "Health" },
    { id: "bpm", label: " bpm", group: "health" },
    { id: "kgm2", label: " kg/m²", group: "health" },
  ],
};
