import { Module } from '@nestjs/common';
import { SystemFeaturesService } from './system-features.service';
import { SystemFeaturesController } from './system-features.controller';
import { FeatureCheckService } from './feature-check.service';

@Module({
  controllers: [SystemFeaturesController],
  providers: [SystemFeaturesService, FeatureCheckService],
  exports: [SystemFeaturesService, FeatureCheckService],
})
export class SystemFeaturesModule {}
