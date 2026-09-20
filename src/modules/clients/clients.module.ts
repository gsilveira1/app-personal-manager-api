import { Module, forwardRef } from "@nestjs/common";
import { ClientsService } from "./clients.service";
import { ClientsController } from "./clients.controller";
import { StudentsController } from "./students.controller";
import { GcsModule } from "../gcs/gcs.module";
import { AnamnesisModule } from "../anamnesis/anamnesis.module";

@Module({
  imports: [GcsModule, forwardRef(() => AnamnesisModule)],
  controllers: [ClientsController, StudentsController],
  providers: [ClientsService],
  exports: [ClientsService], // Exportamos caso FinancesModule precise acessar dados de clientes
})
export class ClientsModule {}
