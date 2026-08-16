import { EvaluationsCalculatorService } from './evaluations-calculator.service';

describe('EvaluationsCalculatorService', () => {
  let service: EvaluationsCalculatorService;

  beforeEach(() => {
    service = new EvaluationsCalculatorService();
  });

  describe('Jackson & Pollock 3 Dobras', () => {
    it('should calculate body density and fat percentage correctly for a 30yo male', () => {
      const result = service.calculate({
        gender: 'M',
        age: 30,
        weight: 80,
        height: 180,
        protocol: 'POLLOCK_3',
        equation: 'SIRI',
        skinfolds: {
          chest: 12,
          abdominal: 20,
          thigh: 15,
        },
      });

      expect(result.protocolUsed).toBe('POLLOCK_3');
      expect(result.equationUsed).toBe('SIRI');
      expect(result.bodyDensity).toBeGreaterThan(1.04);
      expect(result.bodyFatPercentage).toBeGreaterThan(5);
      expect(result.bodyFatPercentage).toBeLessThan(35);
      expect(result.fatMass + result.leanMass).toBeCloseTo(80, 1);
      expect(result.bmi).toBe(24.69);
    });

    it('should calculate correctly for a female using Pollock 3', () => {
      const result = service.calculate({
        gender: 'F',
        age: 28,
        weight: 60,
        height: 165,
        protocol: 'POLLOCK_3',
        equation: 'SIRI',
        skinfolds: {
          triceps: 15,
          suprailiac: 18,
          thigh: 20,
        },
      });

      expect(result.bodyDensity).toBeGreaterThan(1.02);
      expect(result.bodyFatPercentage).toBeGreaterThan(10);
      expect(result.fatMass + result.leanMass).toBeCloseTo(60, 1);
    });
  });

  describe('Jackson & Pollock 7 Dobras', () => {
    it('should calculate body density for Pollock 7', () => {
      const result = service.calculate({
        gender: 'M',
        age: 35,
        weight: 85,
        protocol: 'POLLOCK_7',
        equation: 'SIRI',
        skinfolds: {
          chest: 10,
          midaxillary: 12,
          triceps: 10,
          subscapular: 14,
          abdominal: 18,
          suprailiac: 15,
          thigh: 16,
        },
      });

      expect(result.protocolUsed).toBe('POLLOCK_7');
      expect(result.bodyDensity).toBeGreaterThan(1.03);
      expect(result.fatMass).toBeGreaterThan(0);
    });
  });

  describe('Petroski 4 Dobras', () => {
    it('should calculate body density for Petroski 4 (Brazilian population standard)', () => {
      const result = service.calculate({
        gender: 'M',
        age: 25,
        weight: 75,
        protocol: 'PETROSKI_4',
        equation: 'SIRI',
        skinfolds: {
          triceps: 10,
          subscapular: 12,
          suprailiac: 14,
          calf: 8,
        },
      });

      expect(result.protocolUsed).toBe('PETROSKI_4');
      expect(result.bodyDensity).toBeGreaterThan(1.04);
      expect(result.bodyFatPercentage).toBeGreaterThan(5);
    });

    it('should calculate for female in Petroski 4 using log10 formula', () => {
      const result = service.calculate({
        gender: 'F',
        age: 37,
        weight: 60.3,
        protocol: 'PETROSKI_4',
        equation: 'SIRI',
        skinfolds: {
          triceps: 11.3,
          subscapular: 11.5,
          suprailiac: 16,
          calf: 8.2,
        },
      });

      expect(result.protocolUsed).toBe('PETROSKI_4');
      expect(result.bodyFatPercentage).toBeGreaterThan(10);
    });
  });

  describe('Durnin & Womersley 4 Dobras', () => {
    it('should calculate body density using age bracketed coefficients', () => {
      const result = service.calculate({
        gender: 'M',
        age: 42,
        weight: 82,
        protocol: 'DURNIN_WOMERSLEY_4',
        equation: 'BROZEK',
        skinfolds: {
          biceps: 6,
          triceps: 12,
          subscapular: 14,
          suprailiac: 16,
        },
      });

      expect(result.protocolUsed).toBe('DURNIN_WOMERSLEY_4');
      expect(result.equationUsed).toBe('BROZEK');
      expect(result.bodyFatPercentage).toBeGreaterThan(5);
    });
  });

  describe('Conversion Equation: Siri vs Brozek', () => {
    it('should yield slightly different percentages between Siri and Brozek equations', () => {
      const input = {
        gender: 'M',
        age: 30,
        weight: 80,
        protocol: 'POLLOCK_3',
        skinfolds: { chest: 12, abdominal: 20, thigh: 15 },
      };

      const resSiri = service.calculate({ ...input, equation: 'SIRI' });
      const resBrozek = service.calculate({ ...input, equation: 'BROZEK' });

      expect(resSiri.bodyFatPercentage).not.toEqual(resBrozek.bodyFatPercentage);
      expect(Math.abs(resSiri.bodyFatPercentage - resBrozek.bodyFatPercentage)).toBeLessThan(2);
    });
  });
});
