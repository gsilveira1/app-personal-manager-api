import { validate } from 'class-validator';
import { UpdateBrandingDto } from './branding.dto';

describe('UpdateBrandingDto', () => {
  it('should validate valid dto with valid url and valid hex color', async () => {
    const dto = new UpdateBrandingDto();
    dto.logoUrl = 'https://pub-r2.viviops.com/logos/brand.png';
    dto.primaryColor = '#10B981';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject invalid primaryColor that is not a hex color', async () => {
    const dto = new UpdateBrandingDto();
    dto.primaryColor = 'not-a-hex-color';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('primaryColor');
  });

  it('should reject invalid logoUrl that is not a URL', async () => {
    const dto = new UpdateBrandingDto();
    dto.logoUrl = 'invalid-url-format';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('logoUrl');
  });

  it('should allow optional fields to be omitted', async () => {
    const dto = new UpdateBrandingDto();
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
