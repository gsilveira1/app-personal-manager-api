import { IsString, IsNotEmpty, IsIn } from "class-validator";

export class ResendLinkDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(["WORKOUT_SHEET", "ANAMNESIS"])
  type!: "WORKOUT_SHEET" | "ANAMNESIS";
}
