import { IsString, IsNumber, IsDateString, IsEnum, IsUUID, IsOptional } from 'class-validator';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

export class CreateFinanceRecordDto {
  @IsUUID()
  clientId!: string;

  @IsNumber()
  amount!: number;

  @IsDateString()
  date!: string;

  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;

  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsString()
  description!: string;

  @IsString()
  type!: string; // Subscription | OneTime

  @IsOptional()
  @IsString()
  relatedId?: string;
}

export class MarkPaidDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;
}