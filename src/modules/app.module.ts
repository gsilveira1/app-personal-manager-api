import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { SessionsModule } from "./sessions/sessions.module";
import { ClientsModule } from "./clients/clients.module";
import { PlansModule } from "./plans/plans.module";
import { SettingsModule } from "./settings/settings.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { EvaluationsModule } from "./evaluations/evaluations.module";
import { LeadsModule } from "./leads/leads.module";
import { GcsModule } from "./gcs/gcs.module";
import { AvailabilityBlocksModule } from "./availability-blocks/availability-blocks.module";
import { SystemFeaturesModule } from "./system-features/system-features.module";
import { AiModule } from "./ai/ai.module";
import { StorageModule } from "./storage/storage.module";
import { TenantsModule } from "./tenants/tenants.module";
import { AnamnesisModule } from "./anamnesis/anamnesis.module";
import { ExercisesModule } from "./exercises/exercises.module";
import { WorkoutSheetsModule } from "./workout-sheets/workout-sheets.module";
import { StudentPortalModule } from "./student-portal/student-portal.module";
import { MessagingModule } from "./messaging/messaging.module";
import { AdminModule } from "./admin/admin.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    PrismaModule,
    SessionsModule,
    EvaluationsModule,
    ClientsModule,
    PlansModule,
    SettingsModule,
    LeadsModule,
    GcsModule,
    AvailabilityBlocksModule,
    SystemFeaturesModule,
    AiModule,
    StorageModule,
    TenantsModule,
    AnamnesisModule,
    ExercisesModule,
    WorkoutSheetsModule,
    StudentPortalModule,
    MessagingModule,
    AdminModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
