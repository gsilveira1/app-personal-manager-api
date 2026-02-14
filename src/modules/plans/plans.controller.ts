import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { PlansService } from './plans.service';
import { CreatePlanDto } from './plans-create.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt'))
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post()
  create(@Request() req: RequestWithUser, @Body() createPlanDto: CreatePlanDto) {
    return this.plansService.create(req.user.userId, createPlanDto);
  }

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.plansService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.plansService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  update(@Request() req: RequestWithUser, @Param('id') id: string, @Body() updatePlanDto: Partial<CreatePlanDto>) {
    return this.plansService.update(req.user.userId, id, updatePlanDto);
  }

  @Delete(':id')
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.plansService.remove(req.user.userId, id);
  }
}