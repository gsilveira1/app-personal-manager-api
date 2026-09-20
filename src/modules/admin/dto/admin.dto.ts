import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsNumber,
  IsBoolean,
  IsObject,
  IsIn,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class AdminTenantQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateTenantAdminDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  slug!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsNumber()
  @IsOptional()
  maxStudents?: number = 50;

  @IsBoolean()
  @IsOptional()
  canUploadVideos?: boolean = true;

  @IsBoolean()
  @IsOptional()
  whatsappAlerts?: boolean = true;
}

export class UpdateTenantAdminDto {
  @IsString()
  @IsOptional()
  @IsIn(["ACTIVE", "BLOCKED", "OVERDUE"])
  status?: "ACTIVE" | "BLOCKED" | "OVERDUE";

  @IsObject()
  @IsOptional()
  features?: Record<string, any>;
}
