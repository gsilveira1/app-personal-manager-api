import {
  IsString,
  IsEmail,
  Length
} from 'class-validator';

export class AuthLoginDTO {
  @IsString()
  @Length(6, 16)
  password!: string;

  @IsEmail()
  @IsString()
  email!: string;
}
