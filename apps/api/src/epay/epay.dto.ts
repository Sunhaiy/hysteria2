import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEpayPaymentDto {
  @IsString()
  @IsNotEmpty()
  offerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  discountCode?: string;
}
