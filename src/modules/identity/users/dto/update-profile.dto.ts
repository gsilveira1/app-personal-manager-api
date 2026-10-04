import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from "class-validator";
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, SLUG_PATTERN } from "../../slug";

/** Body of PATCH /users/profile. `role` and `status` are not editable here. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: "A senha deve ter pelo menos 6 caracteres" })
  password?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  @Length(SLUG_MIN_LENGTH, SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, {
    message:
      "slug must contain only lower-case letters, digits and single dashes",
  })
  slug?: string;
}
