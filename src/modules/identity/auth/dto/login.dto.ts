import { IsEmail, IsString, Length } from "class-validator";

export class AuthLoginDTO {
  @IsString()
  @Length(6, 128)
  password!: string;

  @IsEmail()
  @IsString()
  email!: string;
}
