import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CheckoutDto {
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
