import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { PlansService } from './plans.service';
import { CreatePlanDto } from './plans-create.dto';
import { RequestWithUser } from '../../types/global';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  // --- Public endpoint (no auth required) ---
  @Get('public/:trainerId')
  findPublic(@Param('trainerId') trainerId: string) {
    return this.plansService.findPublicByTrainer(trainerId);
  }

  // --- Protected endpoints ---
  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(@Request() req: RequestWithUser, @Body() createPlanDto: CreatePlanDto) {
    return this.plansService.create(req.user.userId, createPlanDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.plansService.findAll(req.user.userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.plansService.findOne(req.user.userId, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  update(@Request() req: RequestWithUser, @Param('id') id: string, @Body() updatePlanDto: Partial<CreatePlanDto>) {
    return this.plansService.update(req.user.userId, id, updatePlanDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.plansService.remove(req.user.userId, id);
  }
}
