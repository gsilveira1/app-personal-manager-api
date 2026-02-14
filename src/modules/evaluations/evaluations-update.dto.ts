import { PartialType } from '@nestjs/mapped-types';
import { CreateEvaluationDto } from './evaluations-create.dto';

export class UpdateEvaluationDto extends PartialType(CreateEvaluationDto) {}
