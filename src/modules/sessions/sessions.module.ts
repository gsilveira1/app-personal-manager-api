import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { SettingsModule } from '../settings/settings.module';
import { AvailabilityBlocksModule } from '../availability-blocks/availability-blocks.module';

@Module({
  imports: [SettingsModule, AvailabilityBlocksModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}