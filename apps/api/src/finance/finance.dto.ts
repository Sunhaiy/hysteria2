import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRefundDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsIn(['wallet', 'manual'])
  method!: 'wallet' | 'manual';

  @IsString()
  @MaxLength(240)
  reason!: string;
}

export class CreateNodeCostDto {
  @IsString()
  nodeId!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  providerReference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
