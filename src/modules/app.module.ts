import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AiModule } from "./ai/ai.module";
import { CalendarModule } from "./calendar/calendar.module";
import { CrmModule } from "./crm/crm.module";
import { GcsModule } from "./gcs/gcs.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { MessagingModule } from "./messaging/messaging.module";
import { PrismaModule } from "./prisma/prisma.module";
import { WorkoutsModule } from "./workouts/workouts.module";

/**
 * Composition root. Infrastructure first (config, Prisma and GCS are global), then
 * the six domain modules of docs/api-contract-v2.md, section 3.
 *
 * Cross-module dependencies are resolved by each consumer importing the module
 * that exports the port it injects (section 3.1 DAG); nothing is re-exported
 * here. ClientDirectoryModule and MailerModule are imported by their consumers,
 * and MessagingModule registers the BullMQ root itself.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    GcsModule,
    AiModule,
    IdentityModule,
    MessagingModule,
    WorkoutsModule,
    HealthModule,
    CrmModule,
    CalendarModule,
  ],
})
export class AppModule {}
