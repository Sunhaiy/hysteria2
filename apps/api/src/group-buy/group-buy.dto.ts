import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateGroupBuyPaymentDto {
  @IsString()
  campaignId!: string;

  @IsIn(['alipay', 'wxpay', 'balance'])
  paymentType!: 'alipay' | 'wxpay' | 'balance';

  @IsOptional()
  @IsIn(['scheduled_switch', 'immediate_switch'])
  planActivation?: 'scheduled_switch' | 'immediate_switch';
}

export class JoinGroupBuyPaymentDto {
  @IsIn(['alipay', 'wxpay', 'balance'])
  paymentType!: 'alipay' | 'wxpay' | 'balance';

  @IsOptional()
  @IsIn(['scheduled_switch', 'immediate_switch'])
  planActivation?: 'scheduled_switch' | 'immediate_switch';
}

export class UpdateGroupBuyCampaignsDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  offerIds!: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  discountPercent!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1024)
  bonusTrafficGiB!: number;
}
