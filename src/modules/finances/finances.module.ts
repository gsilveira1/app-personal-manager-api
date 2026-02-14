import { Module } from '@nestjs/common';
import { FinancesService } from './finances.service';
import { FinancesController } from './finances.controller';
import { PaymentsService } from '../payments/payments.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [FinancesController],
  providers: [FinancesService, PaymentsService],

})
export class FinancesModule {}
