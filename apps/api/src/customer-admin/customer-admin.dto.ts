import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class DeleteCustomerDto {
  @IsEmail()
  confirmationEmail!: string;
}

export class CustomerStatusDto {
  @IsIn(['active', 'suspended', 'banned'])
  status!: 'active' | 'suspended' | 'banned';
}

export class CustomerBalanceAdjustmentDto {
  @IsInt()
  @Min(0)
  expectedBalanceCents!: number;
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
  expectedRemainingBytes!: number;
  @IsInt()
  @Min(0)
  remainingBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

export class CustomerActivationDto {
  @IsString()
  @MaxLength(64)
  expectedState!: string;

  @IsString()
  @MaxLength(240)
  reason!: string;
}

export class CustomerPlanSwitchDto {
  @IsString()
  @MaxLength(12000)
  expectedState!: string;

  @IsString()
  @MaxLength(240)
  reason!: string;

  @IsString()
  offerId!: string;
}

export class CustomerTrafficPolicyDto {
  @IsNumber()
  expectedMultiplier!: number;

  @IsString()
  @MaxLength(240)
  reason!: string;
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
