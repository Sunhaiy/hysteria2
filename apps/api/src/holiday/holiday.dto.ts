import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class HolidayPurchaseDto {
  @IsIn(['TOPUP', 'PLAN']) kind!: 'TOPUP' | 'PLAN';
  @IsOptional() @IsString() @MaxLength(120) tierId?: string;
  @IsOptional() @IsString() @MaxLength(120) offerId?: string;
  @IsIn(['alipay', 'wxpay', 'wallet']) paymentType!:
    | 'alipay'
    | 'wxpay'
    | 'wallet';
  @IsOptional()
  @IsIn(['scheduled_switch', 'immediate_switch'])
  planActivation?: 'scheduled_switch' | 'immediate_switch';
  @IsBoolean() immediateConfirmed!: boolean;
  @IsInt() @Min(1) revision!: number;
  @IsInt() @Min(1) expectedPriceCents!: number;
  @IsBoolean() expectsDraw!: boolean;
}

export class HolidayQuoteDto {
  @IsString() @MaxLength(120) offerId!: string;
  @IsOptional()
  @IsIn(['scheduled_switch', 'immediate_switch'])
  planActivation?: 'scheduled_switch' | 'immediate_switch';
}

export type HolidayConfig = {
  backgroundImageUrl?: string;
  inviteRewardCents?: number;
  tiers: { id: string; amountCents: number; giftCents: number }[];
  offers: { offerId: string; discountBasisPoints: number }[];
  prizes: { cents: number; count: number }[];
};

export const HOLIDAY_ID = 'autumn-2026';
export const DEFAULT_PRIZES = [
  { cents: 0, count: 300 },
  { cents: 50, count: 120 },
  { cents: 100, count: 50 },
  { cents: 200, count: 20 },
  { cents: 500, count: 10 },
];
