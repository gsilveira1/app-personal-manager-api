import { IsString, IsIn } from 'class-validator';

export class UpdateAiInstructionsDto {
  @IsString()
  instructions!: string;
}

export class UpdateLanguageDto {
  @IsString()
  @IsIn(['en', 'es', 'pt-BR'], { message: "language must be one of: 'en', 'es', 'pt-BR'" })
  language!: string;
}