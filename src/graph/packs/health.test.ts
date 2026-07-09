import { describe, it, expect } from "vitest";
import { HEALTH_FORMULAS } from "./health";
import { auditFormulaPack, entryByType, evalFormula } from "./formulaTestKit";

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(HEALTH_FORMULAS, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

// Reference person: 70 kg, 175 cm, 30 years.
describe("Health & Fitness formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(HEALTH_FORMULAS)).toEqual([]);
  });

  it("BMI, BSA, ideal weight", () => {
    expect(num("hf-bmi", { w: 70, h: 1.75 })).toBeCloseTo(22.857, 2);
    expect(num("hf-bsa-mosteller", { w: 70, hcm: 175 })).toBeCloseTo(1.8447, 3);
    expect(num("hf-bsa-dubois", { w: 70, hcm: 175 })).toBeCloseTo(1.8481, 3);
    expect(num("hf-ibw-devine-m", { hcm: 175 })).toBeCloseTo(70.47, 1);
    expect(num("hf-ibw-devine-w", { hcm: 175 })).toBeCloseTo(65.97, 1);
  });

  it("body composition", () => {
    // Deurenberg at BMI 22.86, age 30.
    expect(num("hf-bodyfat-deurenberg-m", { bmi: 22.857, age: 30 })).toBeCloseTo(18.13, 1);
    expect(num("hf-bodyfat-deurenberg-w", { bmi: 22.857, age: 30 })).toBeCloseTo(28.93, 1);
    // Navy tape method, hand-computed reference.
    expect(num("hf-bodyfat-navy-m", { waist: 85, neck: 37, hcm: 175 })).toBeCloseTo(17.72, 1);
    expect(num("hf-bodyfat-navy-w", { waist: 75, hip: 95, neck: 33, hcm: 165 })).toBeCloseTo(26.92, 1);
  });

  it("BMR / TDEE / calories", () => {
    expect(num("hf-bmr-mifflin-m", { w: 70, hcm: 175, age: 30 })).toBeCloseTo(1648.75, 2);
    expect(num("hf-bmr-mifflin-w", { w: 70, hcm: 175, age: 30 })).toBeCloseTo(1482.75, 2);
    expect(num("hf-bmr-harris-m", { w: 70, hcm: 175, age: 30 })).toBeCloseTo(1695.66, 1);
    expect(num("hf-bmr-harris-w", { w: 70, hcm: 175, age: 30 })).toBeCloseTo(1507.13, 1);
    expect(num("hf-tdee", { bmr: 1648.75, activity: 1.55 })).toBeCloseTo(2555.56, 1);
    // 1 hour of running (9.8 METs) at 70 kg → 686 kcal.
    expect(num("hf-calories-mets", { met: 9.8, w: 70, hrs: 1 })).toBeCloseTo(686, 9);
  });

  it("cardio", () => {
    expect(num("hf-maxhr-classic", { age: 30 })).toBe(190);
    expect(num("hf-maxhr-tanaka", { age: 30 })).toBe(187);
    expect(num("hf-karvonen", { hrmax: 190, hrrest: 60, intensity: 0.7 })).toBe(151);
    // Cooper: 2400 m in 12 min → 42.4 ml/kg/min.
    expect(num("hf-vo2max-cooper", { d: 2400 })).toBeCloseTo(42.37, 1);
  });

  it("clinical", () => {
    expect(num("hf-crcl-cockcroft-m", { age: 60, w: 70, scr: 1 })).toBeCloseTo(77.78, 1);
    expect(num("hf-crcl-cockcroft-w", { age: 60, w: 70, scr: 1 })).toBeCloseTo(66.11, 1);
  });
});
