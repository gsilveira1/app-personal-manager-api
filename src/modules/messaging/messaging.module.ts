import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import {
  MessagingController,
  StudentMessagingController,
} from "./messaging.controller";
import { AnamnesisModule } from "../anamnesis/anamnesis.module";
import { StudentPortalModule } from "../student-portal/student-portal.module";

@Module({
  imports: [AnamnesisModule, StudentPortalModule],
  controllers: [MessagingController, StudentMessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}

