import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { ClientsService } from './clients.service';
import { CreateClientDto } from './clients-create.dto';
import { UpdateClientDto } from './clients-update.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt')) // Protege todas as rotas
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req: RequestWithUser, @Body() createClientDto: CreateClientDto) {
    // req.user é populado pelo JwtStrategy
    return this.clientsService.create(req.user.userId, createClientDto);
  }

  @Get()
  findAll(@Request() req: RequestWithUser) {
    return this.clientsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.clientsService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  update(@Request() req: RequestWithUser, @Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.clientsService.update(req.user.userId, id, updateClientDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.clientsService.remove(req.user.userId, id);
  }
}