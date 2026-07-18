import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateLanguageDto } from './settings.dto';

async function validateDto(data: object) {
  const dto = plainToInstance(UpdateLanguageDto, data);
  return validate(dto);
}

describe('UpdateLanguageDto', () => {
  describe('valid locales', () => {
    it.each(['en', 'es', 'pt-BR'])('accepts "%s"', async (language) => {
      const errors = await validateDto({ language });
      expect(errors).toHaveLength(0);
    });
  });

  describe('invalid locales', () => {
    it('rejects unsupported locale "fr"', async () => {
      const errors = await validateDto({ language: 'fr' });
      expect(errors.length).toBeGreaterThan(0);
      const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      expect(messages.some((m) => m.includes("language must be one of: 'en', 'es', 'pt-BR'"))).toBe(true);
    });

    it('rejects partial locale "pt"', async () => {
      const errors = await validateDto({ language: 'pt' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects empty string', async () => {
      const errors = await validateDto({ language: '' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects undefined language field', async () => {
      const errors = await validateDto({});
      expect(errors.length).toBeGreaterThan(0);
      const props = errors.map((e) => e.property);
      expect(props).toContain('language');
    });

    it('rejects number instead of string', async () => {
      const errors = await validateDto({ language: 123 });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
