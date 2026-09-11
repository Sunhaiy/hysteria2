import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SeoListQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class UpdateSeoSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  aiBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  textModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  imageModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  aiApiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearAiApiKey?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5_000)
  @Max(180_000)
  timeoutMs?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  scheduleDays?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  scheduleHour?: number;

  @IsOptional()
  @IsBoolean()
  indexNowEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  googleEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  googleProperty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  googleServiceAccountJson?: string;

  @IsOptional()
  @IsBoolean()
  clearGoogleServiceAccount?: boolean;
}

export class CreateSeoKeywordDto {
  @IsString()
  @MaxLength(120)
  keyword!: string;

  @IsString()
  @MaxLength(80)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  searchIntent?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-100)
  @Max(100)
  priority?: number;
}

export class UpdateSeoKeywordDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  searchIntent?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-100)
  @Max(100)
  priority?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'])
  status?: 'ACTIVE' | 'PAUSED';
}

export class SaveSeoArticleDto {
  @IsString()
  @MaxLength(100)
  slug!: string;

  @IsString()
  @MaxLength(80)
  category!: string;

  @IsString()
  @MaxLength(80)
  title!: string;

  @IsString()
  @MaxLength(300)
  excerpt!: string;

  @IsObject()
  contentJson!: Record<string, unknown>;

  @IsString()
  @MaxLength(120)
  primaryKeyword!: string;

  @IsArray()
  @IsString({ each: true })
  relatedKeywords!: string[];

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsString()
  @MaxLength(70)
  seoTitle!: string;

  @IsString()
  @MaxLength(180)
  metaDescription!: string;

  @IsOptional()
  @IsString()
  coverImageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  coverAlt?: string;
}

export class ScheduleSeoArticleDto {
  @IsDateString()
  scheduledAt!: string;
}

export class GenerateSeoArticleDto {
  @IsOptional()
  @IsString()
  keywordId?: string;
}
