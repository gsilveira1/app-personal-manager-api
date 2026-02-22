import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { ClientsService } from './clients.service';
import { CreateClientDto } from './clients-create.dto';
import { UpdateClientDto } from './clients-update.dto';
import { ConvertLeadDto } from './convert-lead.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt'))
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req: RequestWithUser, @Body() createClientDto: CreateClientDto) {
    return this.clientsService.create(req.user.userId, createClientDto);
  }

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.clientsService.findAll(req.user.userId);
  }

  // IMPORTANT: Must be defined before :id route to avoid routing conflict
  @Get('leads')
  findLeads(@Request() req: RequestWithUser) {
    return this.clientsService.findLeads(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.clientsService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  update(@Request() req: RequestWithUser, @Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.clientsService.update(req.user.userId, id, updateClientDto);
  }

  @Patch(':id/convert')
  convertLead(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() convertLeadDto: ConvertLeadDto,
  ) {
    return this.clientsService.convertLead(req.user.userId, id, convertLeadDto.planId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.clientsService.remove(req.user.userId, id);
  }
}