import { Module } from "@nestjs/common";

import { ClientDirectoryModule } from "../crm/client-directory.module";
import { IdentityModule } from "../identity/identity.module";
import { WorkoutsModule } from "../workouts/workouts.module";
import { AvailabilityBlocksController } from "./availability-blocks.controller";
import { AvailabilityBlocksService } from "./availability-blocks.service";
import { ConflictDetectorService } from "./conflict-detector.service";
import { PublicAvailabilityController } from "./public-availability.controller";
import { PublicAvailabilityService } from "./public-availability.service";
import { SessionExceptionsService } from "./session-exceptions.service";
import { SessionOccurrencesService } from "./session-occurrences.service";
import { SessionWorkoutsService } from "./session-workouts.service";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

/**
 * Sessions, recurring series, availability blocks and public slots. Owns Event.
 *
 * Consumes USER_DIRECTORY (IdentityModule), CLIENT_DIRECTORY (ClientDirectoryModule)
 * and WORKOUT_SHEET_READER (WorkoutsModule); PrismaService comes from the global
 * PrismaModule. Contract: docs/api-contract-v2.md, section 6.4.
 */
@Module({
  imports: [IdentityModule, ClientDirectoryModule, WorkoutsModule],
  controllers: [
    SessionsController,
    AvailabilityBlocksController,
    PublicAvailabilityController,
  ],
  providers: [
    SessionsService,
    SessionOccurrencesService,
    SessionExceptionsService,
    SessionWorkoutsService,
    ConflictDetectorService,
    AvailabilityBlocksService,
    PublicAvailabilityService,
  ],
})
export class CalendarModule {}
