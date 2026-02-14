import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService], // Exportamos caso FinancesModule precise acessar dados de clientes
})
export class ClientsModule {}
