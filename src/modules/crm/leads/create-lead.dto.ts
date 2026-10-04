import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

import { normalizeEmail } from "../clients/client-parsing";
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
} from "../clients/dto/create-client.dto";

export const LEAD_MESSAGE_MAX_LENGTH = 2000;

/**
 * A phone as people type it: optional `+`, then digits with spaces, dots,
 * hyphens or parentheses. At least 8 digits, at most `PHONE_MAX_LENGTH` characters.
 * Client phones (authenticated routes) are free text of the same maximum length;
 * the public form is stricter because its value ends up in the trainer's notes.
 */
export const LEAD_PHONE_PATTERN = /^\+?(?:[\s().-]*\d){8,}[\s().-]*$/;

/** Body of the public lead form, `POST /public/:slug/leads`. */
export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name!: string;

  @Transform(({ value }) =>
    typeof value === "string" ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PHONE_MAX_LENGTH)
  @Matches(LEAD_PHONE_PATTERN, {
    message: "phone must be a phone number with at least 8 digits",
  })
  phone!: string;

  @IsIn(["presencial", "online", "ambos"])
  interest!: "presencial" | "online" | "ambos";

  @IsString()
  @IsOptional()
  @MaxLength(LEAD_MESSAGE_MAX_LENGTH)
  message?: string;
}
