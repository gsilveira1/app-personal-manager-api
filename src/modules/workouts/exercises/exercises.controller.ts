import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, JwtAuthGuard } from "../../../common/auth";
import { CreateExerciseDto, ExerciseQueryDto } from "./exercise.dto";
import { ExercisesService } from "./exercises.service";

@UseGuards(JwtAuthGuard)
@Controller("exercises")
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  findAll(@CurrentUserId() userId: string, @Query() query: ExerciseQueryDto) {
    return this.exercises.findAll(userId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUserId() userId: string, @Body() dto: CreateExerciseDto) {
    return this.exercises.create(userId, dto);
  }
}
