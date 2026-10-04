import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { jwtModuleAsyncOptions } from "../../common/auth";
import { WORKOUT_SHEET_READER } from "../../common/ports";
import { ClientDirectoryModule } from "../crm/client-directory.module";
import { IdentityModule } from "../identity/identity.module";
import { MessagingModule } from "../messaging/messaging.module";
import { ExercisesController } from "./exercises/exercises.controller";
import { ExercisesService } from "./exercises/exercises.service";
import { ClientActivityService } from "./portal/client-activity.service";
import { MagicLinkService } from "./portal/magic-link.service";
import {
  ClientPortalController,
  StudentPortalController,
} from "./portal/portal.controller";
import { StudentPortalService } from "./portal/student-portal.service";
import { WorkoutSheetReaderService } from "./sheets/workout-sheet-reader.service";
import {
  ClientWorkoutSheetsController,
  WorkoutSheetsController,
  WorkoutTemplatesController,
} from "./sheets/workout-sheets.controller";
import { WorkoutSheetsService } from "./sheets/workout-sheets.service";

/**
 * Sheets, templates, exercise catalogue and student portal. Owns WorkoutSheet, Exercise
 * and StudentSession; provides WORKOUT_SHEET_READER to crm and calendar.
 * Contract: docs/api-contract-v2.md, section 6.3.
 *
 * Depends on identity (USER_DIRECTORY), the client directory (CLIENT_DIRECTORY) and
 * messaging (NOTIFICATION_SENDER); PrismaService comes from the global PrismaModule.
 * The JwtModule signs and verifies the student-portal magic links.
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync(jwtModuleAsyncOptions),
    IdentityModule,
    ClientDirectoryModule,
    MessagingModule,
  ],
  controllers: [
    ExercisesController,
    ClientWorkoutSheetsController,
    WorkoutSheetsController,
    WorkoutTemplatesController,
    StudentPortalController,
    ClientPortalController,
  ],
  providers: [
    ExercisesService,
    WorkoutSheetsService,
    WorkoutSheetReaderService,
    { provide: WORKOUT_SHEET_READER, useExisting: WorkoutSheetReaderService },
    StudentPortalService,
    MagicLinkService,
    ClientActivityService,
  ],
  exports: [WORKOUT_SHEET_READER],
})
export class WorkoutsModule {}
