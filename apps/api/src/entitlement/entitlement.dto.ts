import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateTrafficPolicyDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(100)
  trafficMultiplier!: number;
}

export class QuotaAdjustmentDto {
  @IsIn(['delta', 'set_remaining'])
  mode!: 'delta' | 'set_remaining';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  bytes?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  remainingBytes?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
