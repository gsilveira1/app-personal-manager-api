import { IsHexColor, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsUrl({}, { message: 'logoUrl must be a valid URL' })
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @IsHexColor({ message: 'primaryColor must be a valid HEX color (e.g. #10B981)' })
  primaryColor?: string;
}
