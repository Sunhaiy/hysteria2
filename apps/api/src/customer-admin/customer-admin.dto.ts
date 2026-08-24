import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CustomerStatusDto {
  @IsIn(['active', 'suspended', 'banned'])
  status!: 'active' | 'suspended' | 'banned';
}

export class CustomerBalanceAdjustmentDto {
  @IsInt()
  deltaCents!: number;

  @IsString()
  @MaxLength(240)
  note!: string;
}

export class CustomerQuotaAdjustmentDto {
  @IsInt()
  @Min(0)
  remainingBytes!: number;

  @IsString()
  @MaxLength(240)
  reason!: string;
}

export class CustomerPlanSwitchDto {
  @IsString()
  offerId!: string;
}
