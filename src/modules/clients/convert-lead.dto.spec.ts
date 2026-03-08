import { validate } from 'class-validator';
import { ConvertLeadDto } from './convert-lead.dto';

describe('ConvertLeadDto', () => {
  const createDto = (data: Partial<ConvertLeadDto>): ConvertLeadDto => {
    const dto = new ConvertLeadDto();
    Object.assign(dto, data);
    return dto;
  };

  it('should pass with no fields (all optional)', async () => {
    const dto = createDto({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with valid UUID planId', async () => {
    const dto = createDto({ planId: '550e8400-e29b-41d4-a716-446655440000' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should fail with invalid UUID planId', async () => {
    const dto = createDto({ planId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'planId')).toBe(true);
  });
});
