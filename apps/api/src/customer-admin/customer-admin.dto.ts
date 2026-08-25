import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CustomerStatusDto {
  @IsIn(['active', 'suspended', 'banned'])
  status!: 'active' | 'suspended' | 'banned';
}

export class CustomerBalanceAdjustmentDto {
  @IsInt()
  deltaCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class CustomerQuotaAdjustmentDto {
  @IsInt()
  @Min(0)
  remainingBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

export class CustomerPlanSwitchDto {
  @IsString()
  offerId!: string;
}

export class CustomerTrafficPolicyDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(100)
  trafficMultiplier!: number;
}

export class CustomerQuotaOperationDto {
  @IsIn(['delta', 'set_remaining'])
  mode!: 'delta' | 'set_remaining';

  @IsOptional()
  @IsInt()
  bytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  remainingBytes?: number;

  @IsOptional()
  @IsString()
  grantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}
