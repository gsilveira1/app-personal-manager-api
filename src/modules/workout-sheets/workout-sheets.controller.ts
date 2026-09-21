import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { WorkoutSheetsService } from "./workout-sheets.service";
import {
  CreateWorkoutSheetDto,
  SaveWorkoutTemplateDto,
} from "./dto/workout-sheet.dto";
import { RequestWithUser } from "../../types/global";

@UseGuards(AuthGuard("jwt"))
@Controller("students/:id/workout-sheets")
export class WorkoutSheetsController {
  constructor(private readonly workoutSheetsService: WorkoutSheetsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
    @Body() dto: CreateWorkoutSheetDto,
  ) {
    return this.workoutSheetsService.createForStudent(
      req.user.userId,
      clientId,
      dto,
    );
  }

  @Get()
  findByStudent(
    @Request() req: RequestWithUser,
    @Param("id") clientId: string,
  ) {
    return this.workoutSheetsService.findByStudent(req.user.userId, clientId);
  }
}

@UseGuards(AuthGuard("jwt"))
@Controller("workout-sheets")
export class WorkoutSheetsDetailController {
  constructor(private readonly workoutSheetsService: WorkoutSheetsService) {}

  @Get(":id")
  findOne(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.workoutSheetsService.findOne(req.user.userId, id);
  }
}

@UseGuards(AuthGuard("jwt"))
@Controller("workout-templates")
export class WorkoutTemplatesController {
  constructor(private readonly workoutSheetsService: WorkoutSheetsService) {}

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.workoutSheetsService.findTemplates(req.user.userId);
  }

  @Post("from-sheet/:sheetId")
  @HttpCode(HttpStatus.CREATED)
  createFromSheet(
    @Request() req: RequestWithUser,
    @Param("sheetId") sheetId: string,
    @Body() dto: SaveWorkoutTemplateDto,
  ) {
    return this.workoutSheetsService.saveAsTemplate(
      req.user.userId,
      sheetId,
      dto,
    );
  }
}

@UseGuards(AuthGuard("jwt"))
@Controller("workouts")
export class WorkoutsController {
  constructor(private readonly workoutSheetsService: WorkoutSheetsService) {}

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.workoutSheetsService.findAllWorkouts(req.user.userId);
  }

  @Get(":id")
  findOne(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.workoutSheetsService.findOneWorkout(req.user.userId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req: RequestWithUser, @Body() body: any) {
    return this.workoutSheetsService.createWorkout(req.user.userId, body);
  }

  @Patch(":id")
  update(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.workoutSheetsService.updateWorkout(req.user.userId, id, body);
  }

  @Delete(":id")
  remove(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.workoutSheetsService.deleteWorkout(req.user.userId, id);
  }
}
