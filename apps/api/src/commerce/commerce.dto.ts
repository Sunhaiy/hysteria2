import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CheckoutDto {
  @IsOptional()
  @IsIn(['purchase', 'plan_reset', 'plan_upgrade'])
  purchaseAction?: 'purchase' | 'plan_reset' | 'plan_upgrade';

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  upgradeQuoteToken?: string;

  @IsOptional()
  @IsIn(['scheduled_switch', 'immediate_switch'])
  planActivation?: 'scheduled_switch' | 'immediate_switch';

  @IsOptional()
  @IsIn(['plan', 'plan_offer', 'traffic_pack'])
  kind?: 'plan' | 'plan_offer' | 'traffic_pack';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  offerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  discountCode?: string;
}

export class CommerceRedeemDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsOptional()
  @IsString()
  expectedTrafficPackProductId?: string;
}
