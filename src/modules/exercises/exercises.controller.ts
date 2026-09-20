import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ExercisesService } from "./exercises.service";
import { CreateExerciseDto, ExerciseQueryDto } from "./dto/exercise.dto";
import { RequestWithUser } from "../../types/global";

@UseGuards(AuthGuard("jwt"))
@Controller("exercises")
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  findAll(
    @Request() req: RequestWithUser,
    @Query() query: ExerciseQueryDto,
  ) {
    return this.exercisesService.findAll(req.user.userId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Request() req: RequestWithUser,
    @Body() createExerciseDto: CreateExerciseDto,
  ) {
    return this.exercisesService.create(req.user.userId, createExerciseDto);
  }
}
