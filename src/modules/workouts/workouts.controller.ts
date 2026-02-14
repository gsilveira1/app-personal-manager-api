import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutDto } from './workouts-create.dto';
import { AuthGuard } from '@nestjs/passport';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt'))
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  create(@Request() req: RequestWithUser, @Body() createWorkoutDto: CreateWorkoutDto) {
    return this.workoutsService.create(req.user.userId, createWorkoutDto);
  }

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.workoutsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.workoutsService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  update(@Request() req: RequestWithUser, @Param('id') id: string, @Body() updateWorkoutDto: Partial<CreateWorkoutDto>) {
    return this.workoutsService.update(req.user.userId, id, updateWorkoutDto);
  }

  @Delete(':id')
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.workoutsService.remove(req.user.userId, id);
  }
}