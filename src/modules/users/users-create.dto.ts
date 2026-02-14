import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';

export class CreateUserDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter pelo menos 6 caracteres' })
  password!: string;

  @IsOptional()
  @IsString()
  role?: string; // admin, user
}