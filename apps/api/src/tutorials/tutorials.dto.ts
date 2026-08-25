import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TutorialStepDto {
  @IsString()
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(10_000)
  body!: string;

  @IsOptional()
  @IsString()
  imageId?: string;
}

export class SaveTutorialDraftDto {
  @IsString()
  @MaxLength(120)
  clientName!: string;

  @IsString()
  @MaxLength(120)
  meta!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  externalUrl?: string;

  @IsBoolean()
  active!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TutorialStepDto)
  steps!: TutorialStepDto[];
}
