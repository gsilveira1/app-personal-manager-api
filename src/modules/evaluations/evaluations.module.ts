import { Module } from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsCalculatorService } from './evaluations-calculator.service';

@Module({
  controllers: [EvaluationsController],
  providers: [EvaluationsService, EvaluationsCalculatorService],
  exports: [EvaluationsService, EvaluationsCalculatorService],
})
export class EvaluationsModule {}