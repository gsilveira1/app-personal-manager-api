import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService],
  // O PrismaModule é Global, então não precisa importar aqui, 
  // mas se não fosse global, ele deveria estar no imports: [PrismaModule]
})
export class SessionsModule {}