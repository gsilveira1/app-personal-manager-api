import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { MessagingController } from "./messaging.controller";
import { AnamnesisModule } from "../anamnesis/anamnesis.module";
import { StudentPortalModule } from "../student-portal/student-portal.module";

@Module({
  imports: [AnamnesisModule, StudentPortalModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
