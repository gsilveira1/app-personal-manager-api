import {
    Controller,
    Post,
    Param,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PaymentsService } from './payments.service';
import { BatchPixDto } from './generate-pix.dto';

@Controller('payments')
@UseGuards(AuthGuard('jwt'))
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    /**
     * Generate a MercadoPago PIX charge for a specific finance record.
     * Returns the pix copia-e-cola string and a base64-encoded QR code image.
     */
    @Post('pix/:financeRecordId')
    @HttpCode(HttpStatus.CREATED)
    generatePix(@Param('financeRecordId') financeRecordId: string) {
        return this.paymentsService.generatePixCharge(financeRecordId);
    }

    /**
     * Batch-generate PIX charges for multiple finance records.
     * Returns an array of results, one per ID (successful or failed).
     */
    @Post('pix/batch')
    @HttpCode(HttpStatus.CREATED)
    generateBatchPix(@Body() dto: BatchPixDto) {
        return this.paymentsService.processBatchPixGeneration(dto.ids);
    }
}
