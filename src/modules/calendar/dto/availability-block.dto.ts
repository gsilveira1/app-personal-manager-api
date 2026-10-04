import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";

const RRULE_PREFIX = /^FREQ=/;
const isSent = (_object: unknown, value: unknown) => value !== undefined;

/** Body of `POST /availability-blocks`. The block ends at `dtend`. */
export class CreateAvailabilityBlockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @Matches(RRULE_PREFIX, { message: "rrule must start with FREQ=" })
  rrule?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsDateString()
  dtstart!: string;

  @IsDateString()
  dtend!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Body of `PATCH /availability-blocks/:id` (partial of the create body).
 * `rrule: null` turns a recurring block into a one-off; `notes: null` clears the note.
 */
export class UpdateAvailabilityBlockDto {
  @ValidateIf(isSent)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(RRULE_PREFIX, { message: "rrule must start with FREQ=" })
  rrule?: string | null;

  @ValidateIf(isSent)
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ValidateIf(isSent)
  @IsDateString()
  dtstart?: string;

  @ValidateIf(isSent)
  @IsDateString()
  dtend?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
