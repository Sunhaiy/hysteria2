import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class NodePoolMemberDto {
  @IsString()
  nodeId!: string;

  @IsInt()
  @Min(0)
  priority!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  weight?: number;
}

export class SaveNodePoolDto {
  @IsString()
  slug!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsBoolean()
  active!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodePoolMemberDto)
  members!: NodePoolMemberDto[];
}

export class UpdateNodeOperationsDto {
  @IsIn(['active', 'draining', 'maintenance', 'disabled'])
  lifecycleStatus!: 'active' | 'draining' | 'maintenance' | 'disabled';

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  capacityUsers?: number;
}

export class SaveNodeServerDto {
  @IsString()
  slug!: string;

  @IsString()
  name!: string;

  @IsString()
  hostname!: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsBoolean()
  active!: boolean;
}

export class RequestNodeRuntimeCommandDto {
  @IsIn(['start', 'stop', 'status'])
  action!: 'start' | 'stop' | 'status';

  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}

export class UpdateNodeTrafficLimitDto {
  @IsBoolean()
  enabled!: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  monthlyLimitGiB!: number;

  @IsInt()
  @Min(1)
  @Max(28)
  resetDay!: number;
}
