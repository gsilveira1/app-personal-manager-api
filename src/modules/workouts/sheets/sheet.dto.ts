import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  WorkoutItemInputDto,
  WorkoutStructureInputDto,
} from "../../../common/types";

const NAME_MAX_LENGTH = 200;
const isDefined = (value: unknown): boolean => value !== undefined;

/** Body of `POST /clients/:id/workout-sheets` (contract 6.3, `SheetBody`). */
export class CreateSheetDto extends WorkoutStructureInputDto {
  @IsString() @IsNotEmpty() @MaxLength(NAME_MAX_LENGTH) name!: string;

  @IsOptional() @IsDateString() expiresAt?: string;
}

/** Body of `POST /workout-templates`. */
export class CreateTemplateDto extends WorkoutStructureInputDto {
  @IsString() @IsNotEmpty() @MaxLength(NAME_MAX_LENGTH) name!: string;
}

/**
 * Body of `PATCH /workout-sheets/:id`. `workouts` replaces every item (send the ids
 * back to keep them); `description` / `tags` alone patch only those keys;
 * `expiresAt: null` clears the expiry date.
 */
export class UpdateSheetDto {
  @ValidateIf((dto: UpdateSheetDto) => isDefined(dto.name))
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  @IsOptional() @IsDateString() expiresAt?: string | null;

  @ValidateIf((dto: UpdateSheetDto) => isDefined(dto.workouts))
  @IsArray()
  @ArrayMaxSize(26)
  @ValidateNested({ each: true })
  @Type(() => WorkoutItemInputDto)
  workouts?: WorkoutItemInputDto[];

  @ValidateIf((dto: UpdateSheetDto) => isDefined(dto.description))
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ValidateIf((dto: UpdateSheetDto) => isDefined(dto.tags))
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];
}

/** Body of `POST /workout-templates/from-sheet/:sheetId`. */
export class SaveAsTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(NAME_MAX_LENGTH) name!: string;

  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}
