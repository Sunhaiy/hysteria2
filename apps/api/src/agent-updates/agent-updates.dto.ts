import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class UploadAgentReleaseDto {
  @Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/)
  version!: string;

  @IsIn(['amd64', 'arm64'])
  architecture!: string;
}

export class EnrollAgentDto {
  @IsString()
  @Length(1, 100)
  serverId!: string;

  @Matches(/^(?=.*agent)[A-Za-z0-9][A-Za-z0-9@_.-]{0,100}\.service$/)
  serviceUnit!: string;

  @IsIn(['amd64', 'arm64'])
  architecture!: string;
}

export class CreateAgentRolloutDto {
  @IsString()
  @Length(1, 100)
  releaseId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  installationIds!: string[];

  @Matches(/^[A-Za-z0-9_-]{16,100}$/)
  idempotencyKey!: string;
}

export class AgentHeartbeatDto {
  @IsIn(['amd64', 'arm64'])
  architecture!: string;

  @IsString()
  @MaxLength(64)
  currentVersion!: string;

  @Matches(/^[a-f0-9]{64}$/)
  currentSha256!: string;
}

export class AgentUpdateReportDto {
  @IsIn([
    'DOWNLOADING',
    'VERIFYING',
    'INSTALLING',
    'CHECKING',
    'ROLLING_BACK',
    'SUCCEEDED',
    'ROLLED_BACK',
    'FAILED',
  ])
  status!: string;

  @IsString()
  @MaxLength(1000)
  message!: string;

  @IsString()
  @MaxLength(64)
  currentVersion!: string;

  @Matches(/^[a-f0-9]{64}$/)
  currentSha256!: string;
}
