import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global() permite que o PrismaService seja usado em qualquer lugar 
// sem precisar importar o PrismaModule em cada feature module.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}