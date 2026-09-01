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
  Max,
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

export class AcknowledgeAnnouncementDto {
  @IsString()
  @Length(64, 64)
  version!: string;
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

  @IsOptional()
  @IsBoolean()
  announcementEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  announcementTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  announcementContent?: string;

  @IsOptional()
  @IsString()
  googleClientId?: string;

  @IsOptional()
  @IsString()
  googleClientSecret?: string;

  @IsOptional()
  @IsString()
  githubClientId?: string;

  @IsOptional()
  @IsString()
  githubClientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  siteName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  siteDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  siteBrowserTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  siteIconUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(350)
  @Max(600)
  siteFontWeight?: number;

  @IsOptional()
  @IsIn(['balance', 'cdk'])
  purchaseMode?: 'balance' | 'cdk';

  @IsOptional()
  @IsIn(['store', 'epay'])
  checkoutMode?: 'store' | 'epay';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  epayGatewayUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  epayMerchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  epayMerchantKey?: string;

  @IsOptional()
  @IsIn(['alipay', 'wxpay', 'qqpay'])
  epayPaymentType?: 'alipay' | 'wxpay' | 'qqpay';

  @IsOptional()
  @IsString()
  @MaxLength(20)
  buyButtonText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cdkButtonText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cdkButtonUrl?: string;

  @IsOptional()
  @IsBoolean()
  purchaseNoticeEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  purchaseNoticeTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  purchaseNoticeContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tutorialWindowsClient?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  tutorialWindowsSteps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tutorialWindowsUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tutorialAndroidClient?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  tutorialAndroidSteps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tutorialAndroidUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tutorialIosClient?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  tutorialIosSteps?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tutorialIosUrl?: string;
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

  @IsOptional()
  @IsString()
  @Length(8, 8)
  inviteCode?: string;
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

export class CreateTrafficPackProductDto {
  @IsString()
  @IsNotEmpty()
  slug!: string;

  @IsString()
  @IsNotEmpty()
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
  validityDays!: number;

  @IsString()
  @IsNotEmpty()
  accessProfileId!: string;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsString()
  accent!: string;
}

export class UpdateTrafficPackProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  slug?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
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
  validityDays?: number | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accessProfileId?: string;

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
  @IsOptional()
  @IsIn(['hysteria2', 'vless_reality'])
  protocol?: 'hysteria2' | 'vless_reality';

  @IsOptional()
  @IsString()
  serverId?: string;

  @IsString()
  label!: string;

  @IsString()
  hostname!: string;

  @IsInt()
  @Min(1)
  port!: number;

  @IsOptional()
  @IsBoolean()
  portHoppingEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65534)
  portHoppingStart?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(65535)
  portHoppingEnd?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  portHoppingIntervalSeconds?: number;

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

  @IsOptional()
  @IsString()
  realityPublicKey?: string;

  @IsOptional()
  @IsString()
  realityShortId?: string;

  @IsOptional()
  @IsString()
  realityFingerprint?: string;

  @IsOptional()
  @IsString()
  realitySpiderX?: string;

  @IsOptional()
  @IsString()
  vlessFlow?: string;

  @IsString()
  trafficApiBaseUrl!: string;

  @IsString()
  trafficApiSecret!: string;

  @IsOptional()
  @IsString()
  controlApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  controlApiSecret?: string;

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
  @IsIn(['hysteria2', 'vless_reality'])
  protocol?: 'hysteria2' | 'vless_reality';

  @IsOptional()
  @IsString()
  serverId?: string;

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
  @IsBoolean()
  portHoppingEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65534)
  portHoppingStart?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(65535)
  portHoppingEnd?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  portHoppingIntervalSeconds?: number;

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
  realityPublicKey?: string;

  @IsOptional()
  @IsString()
  realityShortId?: string;

  @IsOptional()
  @IsString()
  realityFingerprint?: string;

  @IsOptional()
  @IsString()
  realitySpiderX?: string;

  @IsOptional()
  @IsString()
  vlessFlow?: string;

  @IsOptional()
  @IsString()
  trafficApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  trafficApiSecret?: string;

  @IsOptional()
  @IsString()
  controlApiBaseUrl?: string;

  @IsOptional()
  @IsString()
  controlApiSecret?: string;

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

  @IsIn(['plan', 'traffic_pack', 'balance', 'discount'])
  kind!: 'plan' | 'traffic_pack' | 'balance' | 'discount';

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  catalogOfferId?: string;

  @IsOptional()
  @IsIn(['renew', 'replace'])
  planMode?: 'renew' | 'replace';

  @IsOptional()
  @IsString()
  trafficPackProductId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  trafficBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  discountCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class AdjustBalanceDto {
  @IsInt()
  @Min(0)
  balanceCents!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class PurchasePlanDto {
  @IsString()
  @IsNotEmpty()
  planId!: string;

  @IsOptional()
  @IsString()
  discountCode?: string;
}

export class PurchaseTrafficPackDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsOptional()
  @IsString()
  discountCode?: string;
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

  @IsOptional()
  @IsString()
  expectedTrafficPackProductId?: string;
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
