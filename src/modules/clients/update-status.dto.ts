import { IsString, IsNotEmpty, IsIn } from "class-validator";

export class UpdateStudentStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(["ACTIVE", "PAUSED", "INACTIVE", "Active", "Inactive", "Lead"])
  status!: string;
}
