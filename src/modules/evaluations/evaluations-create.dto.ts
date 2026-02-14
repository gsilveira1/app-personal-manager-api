import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

class PerimetersDto {
  @IsOptional() @IsNumber() waist?: number;
  @IsOptional() @IsNumber() hip?: number;
  @IsOptional() @IsNumber() chest?: number;
  @IsOptional() @IsNumber() rightArm?: number;
  @IsOptional() @IsNumber() leftArm?: number;
  @IsOptional() @IsNumber() rightThigh?: number;
  @IsOptional() @IsNumber() leftThigh?: number;
  @IsOptional() @IsNumber() rightCalf?: number;
  @IsOptional() @IsNumber() leftCalf?: number;

  // Added based on requirements
  @IsOptional() @IsNumber() relaxedArm?: number;
  @IsOptional() @IsNumber() flexedArm?: number;
  @IsOptional() @IsNumber() forearm?: number;
  @IsOptional() @IsNumber() abdomen?: number;
  @IsOptional() @IsNumber() thigh?: number;
  @IsOptional() @IsNumber() calf?: number;
}

class SkinfoldsDto {
  @IsOptional() @IsNumber() triceps?: number;
  @IsOptional() @IsNumber() subscapular?: number;
  @IsOptional() @IsNumber() suprailiac?: number;
  @IsOptional() @IsNumber() abdominal?: number;
  @IsOptional() @IsNumber() thigh?: number;
  @IsOptional() @IsNumber() calf?: number;
  @IsOptional() @IsNumber() chest?: number;
  @IsOptional() @IsNumber() midaxillary?: number;
  
  // Added based on requirements
  @IsOptional() @IsNumber() biceps?: number;
  @IsOptional() @IsNumber() pectoral?: number;
  @IsOptional() @IsNumber() axillary?: number;
  @IsOptional() @IsNumber() supraSpinal?: number;
}

export class CreateEvaluationDto {
  @IsUUID()
  clientId!: string;

  @IsDateString()
  date!: string;

  @IsNumber()
  weight!: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  bodyFatPercentage?: number;

  @IsOptional()
  @IsNumber()
  leanMass?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PerimetersDto)
  perimeters?: PerimetersDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SkinfoldsDto)
  skinfolds?: SkinfoldsDto;
}
