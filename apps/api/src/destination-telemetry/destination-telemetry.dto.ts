import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DestinationVisitDto {
  @IsString()
  userId!: string;

  @IsString()
  @MaxLength(253)
  target!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsIn(['tcp', 'udp'])
  transport!: 'tcp' | 'udp';

  @IsInt()
  @Min(1)
  connectionCount!: number;

  @IsDateString()
  firstSeenAt!: string;

  @IsDateString()
  lastSeenAt!: string;
}

export class DestinationBatchDto {
  @IsString()
  @MaxLength(120)
  externalId!: string;

  @IsDateString()
  observedAt!: string;

  @IsString()
  @MaxLength(80)
  agentVersion!: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => DestinationVisitDto)
  visits!: DestinationVisitDto[];
}

export class UpdateAdminPermissionsDto {
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['destination_audit.read', 'admin_permissions.manage'], { each: true })
  permissions!: Array<'destination_audit.read' | 'admin_permissions.manage'>;
}
