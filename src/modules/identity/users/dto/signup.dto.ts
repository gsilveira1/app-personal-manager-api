import { IsEmail, IsString, MinLength } from "class-validator";

/**
 * Body of POST /auth/signup. There is no `role` on purpose: every sign-up is a
 * trainer, and the global ValidationPipe rejects the property with a 400.
 */
export class SignupDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6, { message: "A senha deve ter pelo menos 6 caracteres" })
  password!: string;
}
