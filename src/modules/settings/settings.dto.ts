import { IsString } from 'class-validator';

export class UpdateAiInstructionsDto {
  @IsString()
  instructions!: string;
}