import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class CreateWalletTopupDto {
  @IsInt({ message: '充值金额必须为整数分' })
  @Min(1000, { message: '充值金额不能低于 10 元' })
  @Max(2147483647, { message: '充值金额超过系统支持范围' })
  amountCents!: number;

  @IsIn(['alipay', 'wxpay'], { message: '请选择支付宝或微信支付' })
  paymentType!: 'alipay' | 'wxpay';
}

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

  @IsOptional()
  @IsIn(['scheduled_switch', 'immediate_switch'])
  planActivation?: 'scheduled_switch' | 'immediate_switch';
}

export class CreateEpayGatewayTestDto {
  @IsIn(['alipay', 'wxpay'])
  paymentType!: 'alipay' | 'wxpay';
}
