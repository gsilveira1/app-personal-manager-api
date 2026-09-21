import { Module } from "@nestjs/common";
import { WorkoutSheetsService } from "./workout-sheets.service";
import {
  WorkoutSheetsController,
  WorkoutSheetsDetailController,
  WorkoutTemplatesController,
  WorkoutsController,
} from "./workout-sheets.controller";

@Module({
  controllers: [
    WorkoutSheetsController,
    WorkoutSheetsDetailController,
    WorkoutTemplatesController,
    WorkoutsController,
  ],
  providers: [WorkoutSheetsService],
  exports: [WorkoutSheetsService],
})
export class WorkoutSheetsModule {}
