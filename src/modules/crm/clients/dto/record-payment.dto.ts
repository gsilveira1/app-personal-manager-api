import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const PAYMENT_METHODS = ["PIX", "CASH", "CARD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** BRL. Far above any real monthly fee. */
export const MAX_PAYMENT_AMOUNT = 1_000_000;

/** Body of `POST /clients/:id/payments` (was `ManualPaymentDto`). */
export class RecordPaymentDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_PAYMENT_AMOUNT)
  amount!: number;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  /** Until when the subscription is valid; copied to `Client.currentPeriodEnd`. */
  @IsDateString()
  periodEnd!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
