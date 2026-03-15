import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SystemFeaturesService } from './system-features.service';
import { CreateSystemFeatureDto } from './system-features-create.dto';
import { UpdateSystemFeatureDto } from './system-features-update.dto';

@Controller('system-features')
export class SystemFeaturesController {
  constructor(private readonly systemFeaturesService: SystemFeaturesService) {}

  // --- Public endpoint: trainers can see active features ---
  @UseGuards(AuthGuard('jwt'))
  @Get('active')
  findAllActive() {
    return this.systemFeaturesService.findAllActive();
  }

  // --- Admin-only endpoints ---
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Post()
  create(@Body() dto: CreateSystemFeatureDto) {
    return this.systemFeaturesService.create(dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Get()
  findAll() {
    return this.systemFeaturesService.findAll();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.systemFeaturesService.findOne(id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSystemFeatureDto) {
    return this.systemFeaturesService.update(id, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.systemFeaturesService.remove(id);
  }
}
