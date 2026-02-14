import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaymentsService } from './payments.service';
// Controller opcional se quiser expor endpoints diretos de pagamento
// import { PaymentsController } from './payments.controller';

@Module({
  imports: [HttpModule],
  providers: [PaymentsService],
  exports: [PaymentsService], // Exporta para ser usado no FinancesModule
})
export class PaymentsModule {}