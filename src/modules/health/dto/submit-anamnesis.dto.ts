import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { AnamnesisAnswersDto } from "../../../common/types";

/** Body of `POST /anamnesis/submit`: the magic token plus the answers. */
export class SubmitAnamnesisDto extends AnamnesisAnswersDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}
