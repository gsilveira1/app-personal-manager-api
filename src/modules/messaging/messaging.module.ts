import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NOTIFICATION_SENDER } from "../../common/ports";
import { NOTIFICATIONS_QUEUE } from "../../common/types";
import { IdentityModule } from "../identity/identity.module";
import {
  ClientMessagesController,
  MessagingController,
} from "./messaging.controller";
import { MessagingHistoryService } from "./messaging-history.service";
import { NotificationAuditService } from "./notification-audit.service";
import { NotificationSenderService } from "./notification-sender.service";
import { NotificationProcessor } from "./notification.processor";
import { PendingJobIndex } from "./pending-job-index.service";
import { PendingNotificationsService } from "./pending-notifications.service";
import { buildQueueRootOptions } from "./queue.config";
import { WhatsappConnectionService } from "./whatsapp-connection.service";
import { WhatsappController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";

/**
 * Outbound messages: the `notifications` BullMQ queue, its worker, the
 * NotificationLog audit trail and the trainer's WhatsApp connection.
 * Provides and exports NOTIFICATION_SENDER. Contract: docs/api-contract-v2.md §9.
 */
@Module({
  imports: [
    IdentityModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildQueueRootOptions,
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [
    MessagingController,
    ClientMessagesController,
    WhatsappController,
  ],
  providers: [
    WhatsAppService,
    WhatsappConnectionService,
    NotificationAuditService,
    PendingJobIndex,
    NotificationSenderService,
    NotificationProcessor,
    PendingNotificationsService,
    MessagingHistoryService,
    { provide: NOTIFICATION_SENDER, useExisting: NotificationSenderService },
  ],
  exports: [NOTIFICATION_SENDER],
})
export class MessagingModule {}
