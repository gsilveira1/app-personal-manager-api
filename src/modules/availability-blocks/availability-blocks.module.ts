import { Module } from '@nestjs/common';
import { AvailabilityBlocksService } from './availability-blocks.service';
import { AvailabilityBlocksController } from './availability-blocks.controller';

@Module({
  controllers: [AvailabilityBlocksController],
  providers: [AvailabilityBlocksService],
  exports: [AvailabilityBlocksService],
})
export class AvailabilityBlocksModule {}
