import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { EvaluationsService } from './evaluations.service';
import { CreateEvaluationDto } from './evaluations-create.dto';
import { UpdateEvaluationDto } from './evaluations-update.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt')) // Protege todas as rotas
@Controller('evaluations')
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req: RequestWithUser, @Body() createEvaluationDto: CreateEvaluationDto) {
    return this.evaluationsService.create(req.user.userId, createEvaluationDto);
  }

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.evaluationsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.evaluationsService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  update(@Request() req: RequestWithUser, @Param('id') id: string, @Body() updateEvaluationDto: UpdateEvaluationDto) {
    return this.evaluationsService.update(req.user.userId, id, updateEvaluationDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.evaluationsService.remove(req.user.userId, id);
  }
}