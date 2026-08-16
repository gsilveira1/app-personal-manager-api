import { Injectable } from "@nestjs/common";

export interface SkinfoldInputs {
  triceps?: number;
  subscapular?: number;
  biceps?: number;
  chest?: number; // peitoral
  pectoral?: number; // alias
  midaxillary?: number; // axilar média
  axillary?: number; // alias
  suprailiac?: number;
  supraSpinal?: number;
  abdominal?: number;
  thigh?: number; // coxa
  calf?: number; // panturrilha
}

export interface PerimeterInputs {
  waist?: number;
  hip?: number;
  chest?: number;
  relaxedArm?: number;
  flexedArm?: number;
  forearm?: number;
  abdomen?: number;
  thigh?: number;
  calf?: number;
}

export interface CalculationInput {
  gender: "M" | "F" | "male" | "female" | string;
  age: number;
  weight: number; // kg
  height?: number; // cm
  skinfolds?: SkinfoldInputs;
  perimeters?: PerimeterInputs;
  protocol?:
    | "POLLOCK_3"
    | "POLLOCK_7"
    | "PETROSKI_4"
    | "DURNIN_WOMERSLEY_4"
    | string;
  equation?: "SIRI" | "BROZEK" | string;
}

export interface CalculationResult {
  bodyDensity: number;
  bodyFatPercentage: number;
  fatMass: number;
  leanMass: number;
  bmi?: number;
  waistToHipRatio?: number;
  protocolUsed: string;
  equationUsed: string;
  idealWeight?: number;
}

@Injectable()
export class EvaluationsCalculatorService {
  public calculate(input: CalculationInput): CalculationResult {
    const genderNorm = (input.gender || "M").toUpperCase().startsWith("F")
      ? "F"
      : "M";
    const age = input.age || 25;
    const weight = input.weight;
    const protocol = (input.protocol || "POLLOCK_3").toUpperCase();
    const equation = (input.equation || "SIRI").toUpperCase();
    const skinfolds = input.skinfolds || {};

    let bodyDensity = 1.05; // Fallback sensible default if calculation not possible

    if (protocol === "POLLOCK_3") {
      bodyDensity = this.calculatePollock3(genderNorm, age, skinfolds);
    } else if (protocol === "POLLOCK_7") {
      bodyDensity = this.calculatePollock7(genderNorm, age, skinfolds);
    } else if (protocol === "PETROSKI_4") {
      bodyDensity = this.calculatePetroski4(genderNorm, age, skinfolds);
    } else if (protocol === "DURNIN_WOMERSLEY_4") {
      bodyDensity = this.calculateDurninWomersley4(genderNorm, age, skinfolds);
    } else {
      // Auto-detect based on available skinfolds
      if (skinfolds.chest || skinfolds.pectoral) {
        bodyDensity = this.calculatePollock3(genderNorm, age, skinfolds);
      } else if (skinfolds.calf) {
        bodyDensity = this.calculatePetroski4(genderNorm, age, skinfolds);
      } else {
        bodyDensity = this.calculatePollock3(genderNorm, age, skinfolds);
      }
    }

    // Convert Body Density to Body Fat Percentage
    let bodyFatPercentage = 0;
    if (equation === "BROZEK") {
      bodyFatPercentage = (4.57 / bodyDensity - 4.142) * 100;
    } else {
      // Default: Siri (1961)
      bodyFatPercentage = (4.95 / bodyDensity - 4.5) * 100;
    }

    // Ensure non-negative and realistic range
    bodyFatPercentage = Math.max(2, Math.min(60, bodyFatPercentage));

    const fatMass = weight * (bodyFatPercentage / 100);
    const leanMass = weight - fatMass;

    // Optional calculations
    let bmi: number | undefined;
    if (input.height && input.height > 0) {
      const heightInM = input.height / 100;
      bmi = Number((weight / (heightInM * heightInM)).toFixed(2));
    }

    let waistToHipRatio: number | undefined;
    const waist = input.perimeters?.waist || input.perimeters?.abdomen;
    const hip = input.perimeters?.hip;
    if (waist && hip && hip > 0) {
      waistToHipRatio = Number((waist / hip).toFixed(2));
    }

    // Target ideal weight calculation (assuming standard healthy fat target ~15% for M, ~22% for F)
    const targetFatPct = genderNorm === "M" ? 15 : 22;
    const idealWeight = Number(
      (leanMass / (1 - targetFatPct / 100)).toFixed(2),
    );

    return {
      bodyDensity: Number(bodyDensity.toFixed(5)),
      bodyFatPercentage: Number(bodyFatPercentage.toFixed(2)),
      fatMass: Number(fatMass.toFixed(2)),
      leanMass: Number(leanMass.toFixed(2)),
      bmi,
      waistToHipRatio,
      protocolUsed: protocol,
      equationUsed: equation,
      idealWeight,
    };
  }

  private calculatePollock3(
    gender: "M" | "F",
    age: number,
    skinfolds: SkinfoldInputs,
  ): number {
    const chest = skinfolds.chest || skinfolds.pectoral || 0;
    const abdominal = skinfolds.abdominal || 0;
    const thigh = skinfolds.thigh || 0;
    const triceps = skinfolds.triceps || 0;
    const suprailiac = skinfolds.suprailiac || skinfolds.supraSpinal || 0;

    if (gender === "M") {
      const sum = chest + abdominal + thigh;
      if (sum === 0) return 1.06;
      return (
        1.10938 -
        0.0008267 * sum +
        0.0000016 * Math.pow(sum, 2) -
        0.0002574 * age
      );
    } else {
      const sum = triceps + suprailiac + thigh;
      if (sum === 0) return 1.05;
      return (
        1.0994921 -
        0.0009929 * sum +
        0.0000023 * Math.pow(sum, 2) -
        0.0001392 * age
      );
    }
  }

  private calculatePollock7(
    gender: "M" | "F",
    age: number,
    skinfolds: SkinfoldInputs,
  ): number {
    const chest = skinfolds.chest || skinfolds.pectoral || 0;
    const midaxillary = skinfolds.midaxillary || skinfolds.axillary || 0;
    const triceps = skinfolds.triceps || 0;
    const subscapular = skinfolds.subscapular || 0;
    const abdominal = skinfolds.abdominal || 0;
    const suprailiac = skinfolds.suprailiac || skinfolds.supraSpinal || 0;
    const thigh = skinfolds.thigh || 0;

    const sum =
      chest +
      midaxillary +
      triceps +
      subscapular +
      abdominal +
      suprailiac +
      thigh;
    if (sum === 0) return 1.055;

    if (gender === "M") {
      return (
        1.112 -
        0.00043499 * sum +
        0.00000055 * Math.pow(sum, 2) -
        0.00028826 * age
      );
    } else {
      return (
        1.097 -
        0.00046971 * sum +
        0.00000056 * Math.pow(sum, 2) -
        0.00012828 * age
      );
    }
  }

  private calculatePetroski4(
    gender: "M" | "F",
    age: number,
    skinfolds: SkinfoldInputs,
  ): number {
    const triceps = skinfolds.triceps || 0;
    const subscapular = skinfolds.subscapular || 0;
    const suprailiac = skinfolds.suprailiac || skinfolds.supraSpinal || 0;
    const calf = skinfolds.calf || 0;

    const sum = triceps + subscapular + suprailiac + calf;
    if (sum === 0) return 1.055;

    if (gender === "M") {
      return (
        1.10726863 -
        0.00081201 * sum +
        0.00000212 * Math.pow(sum, 2) -
        0.00041761 * age
      );
    } else {
      return 1.1954713 - 0.07513507 * Math.log10(sum) - 0.00041072 * age;
    }
  }

  private calculateDurninWomersley4(
    gender: "M" | "F",
    age: number,
    skinfolds: SkinfoldInputs,
  ): number {
    const biceps = skinfolds.biceps || 0;
    const triceps = skinfolds.triceps || 0;
    const subscapular = skinfolds.subscapular || 0;
    const suprailiac = skinfolds.suprailiac || skinfolds.supraSpinal || 0;

    const sum = biceps + triceps + subscapular + suprailiac;
    if (sum === 0) return 1.055;

    // Determine c and m constants based on age brackets
    let c = 1.162;
    let m = 0.063;

    if (age < 17) {
      c = gender === "M" ? 1.1533 : 1.1369;
      m = gender === "M" ? 0.0643 : 0.0598;
    } else if (age <= 19) {
      c = gender === "M" ? 1.162 : 1.1549;
      m = gender === "M" ? 0.063 : 0.0678;
    } else if (age <= 29) {
      c = gender === "M" ? 1.1631 : 1.1599;
      m = gender === "M" ? 0.0632 : 0.0717;
    } else if (age <= 39) {
      c = gender === "M" ? 1.1422 : 1.1423;
      m = gender === "M" ? 0.0544 : 0.0684;
    } else if (age <= 49) {
      c = gender === "M" ? 1.162 : 1.1333;
      m = gender === "M" ? 0.07 : 0.0612;
    } else {
      c = gender === "M" ? 1.1715 : 1.1339;
      m = gender === "M" ? 0.0779 : 0.0645;
    }

    return c - m * Math.log10(sum);
  }
}
