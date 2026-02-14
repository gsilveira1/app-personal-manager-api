import { 
  IsString, 
  IsEmail, 
  Length
} from 'class-validator';

export class AuthLoginDTO {
  @IsString()
  @Length(6, 6)
  password!: string;

  @IsEmail() 
  @IsString()
  email!: string;
}
