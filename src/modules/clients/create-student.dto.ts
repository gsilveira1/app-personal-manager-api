import { IsString, IsEmail, IsOptional, IsEnum } from "class-validator";
import { ClientStatus, ClientModality } from "@prisma/client";

export class CreateStudentDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @IsEnum(ClientModality)
  @IsOptional()
  modality?: ClientModality = ClientModality.PRESENCIAL;

  @IsEnum(ClientStatus)
  @IsOptional()
  status?: ClientStatus = ClientStatus.ACTIVE;

  @IsString()
  @IsOptional()
  notes?: string;
}
