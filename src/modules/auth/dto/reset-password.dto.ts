import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class ResetPasswordDto {
  @IsString({ message: "Token inválido." })
  @IsNotEmpty({ message: "O token é obrigatório." })
  token!: string;

  @IsString({ message: "A senha deve ser uma string." })
  @IsNotEmpty({ message: "A senha é obrigatória." })
  @MinLength(8, { message: "A nova senha deve conter no mínimo 8 caracteres." })
  password!: string;
}
