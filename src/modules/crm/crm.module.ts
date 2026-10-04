import { Module } from "@nestjs/common";

import { HealthModule } from "../health/health.module";
import { IdentityModule } from "../identity/identity.module";
import { WorkoutsModule } from "../workouts/workouts.module";
import { ClientDirectoryModule } from "./client-directory.module";
import { CRM_CONTROLLERS, CRM_PROVIDERS } from "./crm.providers";
import { FeatureCheckService } from "./plans/feature-check.service";

/**
 * Clients, leads, plans and payments. Owns Client, Plan and Payment.
 *
 * Imports follow the DAG of docs/api-contract-v2.md (section 3.1): identity
 * (USER_DIRECTORY), ClientDirectory (CLIENT_DIRECTORY), workouts
 * (WORKOUT_SHEET_READER) and health (ANAMNESIS_REQUESTER). PrismaService and
 * GcsService come from global modules.
 */
@Module({
  imports: [
    IdentityModule,
    ClientDirectoryModule,
    WorkoutsModule,
    HealthModule,
  ],
  controllers: CRM_CONTROLLERS,
  providers: CRM_PROVIDERS,
  exports: [FeatureCheckService],
})
export class CrmModule {}
