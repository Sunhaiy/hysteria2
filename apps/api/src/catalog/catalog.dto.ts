import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAccessProfileDto {
  @IsString()
  slug!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsBoolean()
  active!: boolean;

  @IsInt()
  @Min(0)
  speedUpMbps!: number;

  @IsInt()
  @Min(0)
  speedDownMbps!: number;

  @IsInt()
  @Min(1)
  deviceLimit!: number;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  nodeIds!: string[];
}

export class UpdateAccessProfileDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  speedUpMbps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  speedDownMbps?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  deviceLimit?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  nodeIds?: string[];
}

export class CreatePlanOfferDto {
  @IsString()
  planId!: string;

  @IsString()
  slug!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(['monthly', 'quarterly', 'yearly'])
  billingPeriod!: 'monthly' | 'quarterly' | 'yearly';

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdatePlanOfferDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['monthly', 'quarterly', 'yearly'])
  billingPeriod?: 'monthly' | 'quarterly' | 'yearly';

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CatalogOfferInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  slug!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(['monthly', 'quarterly', 'yearly'])
  billingPeriod!: 'monthly' | 'quarterly' | 'yearly';

  @IsInt()
  @Min(1)
  trafficBytes!: number;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  storeUrl?: string;

  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class SaveCatalogProductDto {
  @IsString()
  slug!: string;

  @IsIn(['plan', 'traffic_pack'])
  kind!: 'plan' | 'traffic_pack';

  @IsIn(['draft', 'active', 'archived'])
  status!: 'draft' | 'active' | 'archived';

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  storeUrl?: string;

  @IsString()
  accessProfileId!: string;

  @IsInt()
  @Min(0)
  speedUpMbps!: number;

  @IsInt()
  @Min(0)
  speedDownMbps!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  defaultTrafficMultiplier!: number;

  @IsOptional()
  @IsString()
  accent?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CatalogOfferInputDto)
  offers!: CatalogOfferInputDto[];
}
