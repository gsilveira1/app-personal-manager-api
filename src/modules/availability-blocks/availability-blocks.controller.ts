import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AvailabilityBlocksService } from './availability-blocks.service';
import {
  CreateAvailabilityBlockDto,
  UpdateAvailabilityBlockDto,
} from './availability-blocks.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt'))
@Controller('availability-blocks')
export class AvailabilityBlocksController {
  constructor(private readonly service: AvailabilityBlocksService) {}

  @Post()
  create(
    @Request() req: RequestWithUser,
    @Body() dto: CreateAvailabilityBlockDto,
  ) {
    return this.service.create(req.user.userId, dto);
  }

  @Get()
  findAll(
    @Request() req: RequestWithUser,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.service.findAllForRange(
      req.user.userId,
      new Date(start),
      new Date(end),
    );
  }

  @Patch(':id')
  update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateAvailabilityBlockDto,
  ) {
    return this.service.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.service.remove(req.user.userId, id);
  }
}
