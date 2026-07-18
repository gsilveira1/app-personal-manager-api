import { IsString, IsOptional, IsBoolean, Matches } from 'class-validator';

export class CreateSystemFeatureDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'key must be lowercase snake_case (e.g. "ai_whatsapp_bot")',
  })
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
