import {
  IsDateString,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RequestRegisterCodeDto {
  @IsEmail()
  email!: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  smtpPort?: number;

  @IsOptional()
  @IsString()
  smtpUser?: string;

  @IsOptional()
  @IsString()
  smtpPass?: string;

  @IsOptional()
  @IsString()
  smtpFrom?: string;

  @IsOptional()
  @IsBoolean()
  registrationEnabled?: boolean;
}

export class TestEmailDto {
  @IsEmail()
  to!: string;
}

export class OAuthExchangeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayName?: string;
}

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member';

  @IsOptional()
  @IsIn(['active', 'suspended', 'banned'])
  status?: 'active' | 'suspended' | 'banned';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  initialPlanId?: string;

  @IsOptional()
  @IsString()
  initialNodeId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsIn(['admin', 'member'])
  role?: 'admin' | 'member';

  @IsOptional()
  @IsIn(['active', 'suspended', 'banned'])
  status?: 'active' | 'suspended' | 'banned';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePlanDto {
  @IsString()
  slug!: string;

  @IsString()
  name!: string;

  @IsString()
  description!: string;

  @IsBoolean()
  active!: boolean;

  @IsNumber()
  @Min(1)
  trafficBytes!: number;

  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsInt()
  @Min(0)
  speedUpMbps!: number;

  @IsInt()
  @Min(0)
  speedDownMbps!: number;

  @IsInt()
  @Min(1)
  deviceLimit!: number;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsString()
  accent!: string;
}

export class UpdatePlanDto {
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
  @IsNumber()
  @Min(1)
  trafficBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

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
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsString()
  accent?: string;
}

export class CreateSubscriptionDto {
  @IsString()
  userId!: string;

  @IsString()
  planId!: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsIn(['active', 'expired', 'paused', 'canceled'])
  status?: 'active' | 'expired' | 'paused' | 'canceled';

  @IsOptional()
  @IsDateString()
  startsAt?: string;
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsIn(['active', 'expired', 'paused', 'canceled'])
  status?: 'active' | 'expired' | 'paused' | 'canceled';

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  includedTrafficBytes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonusTrafficBytes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  consumedTrafficBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  speedUpMbpsSnapshot?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  speedDownMbpsSnapshot?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  deviceLimitSnapshot?: number;
}

export class CreateNodeDto {
  @IsString()
  label!: string;

  @IsString()
  hostname!: string;

  @IsInt()
  @Min(1)
  port!: number;

  @IsOptional()
  @IsString()
  obfsPassword?: string;

  @IsOptional()
  @IsString()
  sni?: string;

  @IsOptional()
  @IsString()
  pinSHA256?: string;

  @IsBoolean()
  allowInsecureTls!: boolean;

  @IsString()
  trafficApiBaseUrl!: string;

  @IsString()
  trafficApiSecret!: string;

  @IsBoolean()
  active!: boolean;

  @IsInt()
  @Min(0)
  speedUpMbps!: number;

  @IsInt()
  @Min(0)
  speedDownMbps!: number;
}

export class UpdateNodeDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  port?: number;

  @IsOptional()
  @IsString()
  obfsPassword?: string;

  @IsOptional()
  @IsString()
  sni?: string;

  @IsOptional()
  @IsString()
  pinSHA256?: string;

  @IsOptional()
  @IsBoolean()
  allowInsecureTls?: boolean;

  @IsOptional()
  @IsString()
  trafficApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  trafficApiSecret?: string;

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
}

export class ManualCreditDto {
  @IsString()
  userId!: string;

  @IsIn(['renewal', 'traffic_pack', 'manual_credit'])
  kind!: 'renewal' | 'traffic_pack' | 'manual_credit';

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsIn(['pending', 'applied'])
  status?: 'pending' | 'applied';

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  trafficBytes?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateManualOrderDto {
  @IsOptional()
  @IsIn(['applied', 'void'])
  status?: 'applied' | 'void';
}

export class CreatePlanBindingDto {
  @IsString()
  planId!: string;

  @IsString()
  nodeId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdatePlanBindingDto {
  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class CreateRedemptionCodeDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsIn(['plan', 'traffic_pack'])
  kind!: 'plan' | 'traffic_pack';

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  trafficBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateRedemptionCodeDto {
  @IsOptional()
  @IsIn(['active', 'void'])
  status?: 'active' | 'void';
}

export class RedeemCodeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class RequestPlanOrderDto {
  @IsString()
  @IsNotEmpty()
  planId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class HysteriaAuthDto {
  @IsString()
  addr!: string;

  @IsString()
  auth!: string;

  @IsInt()
  @Min(0)
  tx!: number;
}
