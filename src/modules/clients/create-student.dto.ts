import { IsString, IsEmail, IsOptional, Matches, IsIn } from "class-validator";

export class CreateStudentDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: "whatsapp must be in valid E.164 format (e.g. +5511999998888)",
  })
  whatsapp?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  @IsIn(["ONLINE", "PRESENCIAL", "HYBRID"])
  modality?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
