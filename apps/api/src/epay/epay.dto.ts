import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateEpayPaymentDto {
  @IsString()
  @IsNotEmpty()
  offerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  discountCode?: string;

  @IsIn(['alipay', 'wxpay'])
  paymentType!: 'alipay' | 'wxpay';

  @IsOptional()
  @IsIn(['purchase', 'plan_reset'])
  purchaseAction?: 'purchase' | 'plan_reset';
}

export class CreateEpayGatewayTestDto {
  @IsIn(['alipay', 'wxpay'])
  paymentType!: 'alipay' | 'wxpay';
}
