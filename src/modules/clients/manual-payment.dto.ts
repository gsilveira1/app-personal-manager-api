import { IsString, IsNotEmpty, IsDateString, IsOptional, IsNumber } from "class-validator";

export class ManualPaymentDto {
  @IsString()
  @IsNotEmpty()
  paymentType!: string; // 'MANUAL_PIX' | 'MANUAL_CASH' | 'MANUAL_CARD'

  @IsDateString()
  validUntil!: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  @IsOptional()
  amount?: number;
}
