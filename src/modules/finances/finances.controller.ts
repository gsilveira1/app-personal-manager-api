import { Controller, Post, Body, Patch, Param, Get, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { FinancesService } from './finances.service';
import { CreateFinanceRecordDto, MarkPaidDto } from './finances.dto';
import { RequestWithUser } from '../../types/global';

@UseGuards(AuthGuard('jwt'))
@Controller('finances')
export class FinancesController {
  constructor(private readonly financesService: FinancesService) {}

  @Post()
  create(@Request() req: RequestWithUser, @Body() createFinanceRecordDto: CreateFinanceRecordDto) {
    return this.financesService.createRecord(req.user.userId, createFinanceRecordDto);
  }

  @Post('generate-monthly')
  generateMonthly(@Request() req: RequestWithUser) {
    return this.financesService.generateMonthlyInvoices(req.user.userId);
  }

  @Patch(':id/pay')
  markAsPaid(@Request() req: RequestWithUser, @Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.financesService.markAsPaid(req.user.userId, id, dto.method);
  }
}