import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateSystemFeatureDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
