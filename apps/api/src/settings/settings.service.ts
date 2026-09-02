import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EpayPaymentStatus, type Prisma } from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../security/secret-cipher.service';
import { secretSettingKeys } from '../security/secret-migration.service';

export interface SmtpConfig {
  host?: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
  configured: boolean;
}

export type CheckoutMode = 'store' | 'epay';
export type EpayPaymentType = 'alipay' | 'wxpay' | 'qqpay';

export interface EpayConfig {
  checkoutMode: CheckoutMode;
  gatewayUrl?: string;
  merchantId?: string;
  merchantKey?: string;
  paymentType: EpayPaymentType;
  configured: boolean;
  reconciliationReady: boolean;
}

export interface EpaySettingsUpdate {
  checkoutMode?: CheckoutMode;
  epayGatewayUrl?: string;
  epayMerchantId?: string;
  epayMerchantKey?: string;
  epayPaymentType?: EpayPaymentType;
}

export type TutorialUploadPlatform = 'windows' | 'android' | 'macos';

export interface TutorialAssetRecord {
  storedName: string;
  originalName: string;
  size: number;
  uploadedAt: string;
}

const TUTORIAL_DEFAULTS = {
  windows: {
    name: 'Windows',
    meta: '电脑',
    client: 'Clash Verge Rev',
    steps: [
      '下载并安装 Clash Verge Rev 客户端',
      '打开「接入信息」，复制一键订阅链接',
      '在 Clash Verge Rev 中添加订阅地址',
      '更新订阅，选择自动节点并启用系统代理',
    ],
  },
  android: {
    name: 'Android',
    meta: '手机 / 平板',
    client: 'Clash Meta',
    steps: [
      '下载并安装 Clash Meta 客户端',
      '打开「接入信息」，复制一键订阅链接',
      '在 Clash Meta 中从剪贴板添加订阅',
      '选择节点，允许 VPN 权限并开始连接',
    ],
  },
  ios: {
    name: 'iOS',
    meta: 'iPhone / iPad',
    client: 'Stash',
    steps: [
      '从 App Store 安装 Stash 客户端',
      '打开「接入信息」，复制订阅或配置地址',
      '在 Stash 中添加远程订阅',
      '允许 VPN 权限并启动连接',
    ],
  },
} as const;

const settingsCacheKey = 'settings:all:v1';
const publishedTutorialsCacheKey = 'tutorials:published:v2';
const announcementAcknowledgementTtlSeconds = 12 * 60 * 60;

@Injectable()
export class SettingsService {
  private cache: Map<string, string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipherService,
    private readonly sharedCache: CacheService,
  ) {}

  private async all(): Promise<Map<string, string>> {
    if (this.cache) {
      return this.cache;
    }
    const cached = await this.sharedCache.get(settingsCacheKey);
    if (cached) {
      try {
        const values = JSON.parse(cached) as Record<string, unknown>;
        if (
          values &&
          typeof values === 'object' &&
          Object.values(values).every((value) => typeof value === 'string')
        ) {
          this.cache = new Map(
            Object.entries(values) as Array<[string, string]>,
          );
          return this.cache;
        }
      } catch {
        await this.sharedCache.del(settingsCacheKey);
      }
    }
    const rows = await this.prisma.setting.findMany();
    this.cache = new Map(rows.map((row) => [row.key, row.value]));
    await this.sharedCache.set(
      settingsCacheKey,
      JSON.stringify(Object.fromEntries(this.cache)),
      300,
    );
    return this.cache;
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.all()).get(key);
  }

  async setMany(updates: Record<string, string>) {
    const entries = Object.entries(updates);
    if (entries.length > 0) {
      await this.prisma.$transaction(
        entries.map(([key, value]) =>
          this.prisma.setting.upsert({
            where: { key },
            create: {
              key,
              value: secretSettingKeys.includes(key)
                ? this.cipher.encrypt(value)
                : value,
            },
            update: {
              value: secretSettingKeys.includes(key)
                ? this.cipher.encrypt(value)
                : value,
            },
          }),
        ),
      );
    }
    this.cache = null;
    await this.sharedCache.del(settingsCacheKey);
    if (Object.keys(updates).some((key) => key.startsWith('tutorial.'))) {
      await this.sharedCache.del(publishedTutorialsCacheKey);
    }
  }

  async getTutorialAsset(
    platform: TutorialUploadPlatform,
  ): Promise<TutorialAssetRecord | null> {
    const raw = await this.get(`tutorial.${platform}.asset`);
    if (!raw) return null;
    try {
      const asset = JSON.parse(raw) as Partial<TutorialAssetRecord>;
      if (
        typeof asset.storedName !== 'string' ||
        typeof asset.originalName !== 'string' ||
        typeof asset.size !== 'number' ||
        typeof asset.uploadedAt !== 'string'
      ) {
        return null;
      }
      return asset as TutorialAssetRecord;
    } catch {
      return null;
    }
  }

  async saveTutorialAsset(
    platform: TutorialUploadPlatform,
    asset: TutorialAssetRecord,
  ) {
    await this.setMany({
      [`tutorial.${platform}.asset`]: JSON.stringify(asset),
    });
  }

  async getTutorialConfig() {
    const map = await this.all();
    const buildPlatform = async (platform: keyof typeof TUTORIAL_DEFAULTS) => {
      const defaults = TUTORIAL_DEFAULTS[platform];
      const steps = (
        map.get(`tutorial.${platform}.steps`) || defaults.steps.join('\n')
      )
        .split('\n')
        .map((step) => step.trim())
        .filter(Boolean);
      const asset =
        platform === 'ios' ? null : await this.getTutorialAsset(platform);
      return {
        id: platform,
        name: defaults.name,
        meta: defaults.meta,
        client: map.get(`tutorial.${platform}.client`) || defaults.client,
        steps,
        externalUrl: map.get(`tutorial.${platform}.url`) || '',
        asset: asset
          ? {
              originalName: asset.originalName,
              size: asset.size,
              uploadedAt: asset.uploadedAt,
              downloadUrl: `/api/tutorial-assets/${platform}/download`,
            }
          : null,
      };
    };

    return {
      platforms: await Promise.all([
        buildPlatform('windows'),
        buildPlatform('android'),
        buildPlatform('ios'),
      ]),
    };
  }

  /** SMTP config: DB settings take precedence, env vars are the fallback. */
  async getSmtpConfig(): Promise<SmtpConfig> {
    const map = await this.all();
    const pick = (key: string, envKey: string) =>
      map.get(key) || process.env[envKey] || undefined;

    const host = pick('smtp.host', 'SMTP_HOST');
    const user = pick('smtp.user', 'SMTP_USER');
    const storedPass = map.get('smtp.pass');
    const pass = storedPass
      ? this.cipher.decrypt(storedPass)
      : process.env.SMTP_PASS || undefined;
    const from = pick('smtp.from', 'SMTP_FROM') || user;
    const port = Number(pick('smtp.port', 'SMTP_PORT') || 465);

    return {
      host,
      port: Number.isFinite(port) ? port : 465,
      user,
      pass,
      from,
      configured: Boolean(host && user && pass),
    };
  }

  /** Open registration defaults to enabled; admins can turn it off. */
  async isRegistrationEnabled(): Promise<boolean> {
    const value = await this.get('registration.enabled');
    return value === undefined ? true : value === 'true';
  }

  async isReferralEnabled(): Promise<boolean> {
    return (await this.get('referral.enabled')) === 'true';
  }

  async getReferralConfig(client?: Prisma.TransactionClient) {
    const values = client
      ? new Map(
          (
            await client.setting.findMany({
              where: {
                key: {
                  in: ['referral.enabled', 'referral.inviterRewardBasisPoints'],
                },
              },
            })
          ).map((row) => [row.key, row.value]),
        )
      : await this.all();
    const rawBasisPoints = Number.parseInt(
      values.get('referral.inviterRewardBasisPoints') ?? '1000',
      10,
    );
    return {
      enabled: values.get('referral.enabled') === 'true',
      inviterRewardBasisPoints:
        Number.isInteger(rawBasisPoints) &&
        rawBasisPoints >= 0 &&
        rawBasisPoints <= 10_000
          ? rawBasisPoints
          : 1000,
      inviteeRewardBytes: 20 * 1024 * 1024 * 1024,
    };
  }

  async getAnnouncementConfig() {
    const map = await this.all();
    const title = map.get('announcement.title')?.trim() || '服务公告';
    const content = map.get('announcement.content')?.trim() || '';
    return {
      enabled: map.get('announcement.enabled') === 'true',
      title,
      content,
      version: createHash('sha256')
        .update(`${title}\0${content}`)
        .digest('hex'),
    };
  }

  async getPendingAnnouncement(sessionId: string) {
    const announcement = await this.getPublishedAnnouncement();
    if (!announcement) return null;

    const acknowledgement = await this.sharedCache.get(
      this.announcementAcknowledgementKey(sessionId, announcement.version),
    );
    return acknowledgement ? null : announcement;
  }

  async getPublishedAnnouncement() {
    const announcement = await this.getAnnouncementConfig();
    if (!announcement.enabled || !announcement.content) return null;
    return {
      title: announcement.title,
      content: announcement.content,
      version: announcement.version,
    };
  }

  async acknowledgeAnnouncement(sessionId: string, version: string) {
    const announcement = await this.getAnnouncementConfig();
    if (
      !announcement.enabled ||
      !announcement.content ||
      announcement.version !== version
    ) {
      throw new BadRequestException('公告已更新，请重新查看');
    }

    await this.sharedCache.set(
      this.announcementAcknowledgementKey(sessionId, version),
      '1',
      announcementAcknowledgementTtlSeconds,
    );
    return { success: true };
  }

  private announcementAcknowledgementKey(sessionId: string, version: string) {
    return `announcement:ack:${sessionId}:${version}`;
  }

  /** Public site identity used by the UI and browser chrome. */
  async getSiteInfo() {
    const map = await this.all();
    const name = map.get('site.name') || 'Hysteria 2';
    const configuredFontWeight = Number(map.get('site.fontWeight'));
    const fontWeight =
      Number.isInteger(configuredFontWeight) &&
      configuredFontWeight >= 350 &&
      configuredFontWeight <= 600 &&
      configuredFontWeight % 50 === 0
        ? configuredFontWeight
        : 400;
    return {
      name,
      description: map.get('site.description') || '',
      browserTitle: map.get('site.browserTitle') || name,
      iconUrl: map.get('site.iconUrl') || '/favicon.ico',
      fontWeight,
    };
  }

  /** Portal button labels, purchase mode, and the CDK/shop link. */
  async getPortalBranding() {
    const map = await this.all();
    const mode = map.get('portal.purchaseMode');
    const configuredShopUrl = map.get('portal.cdkButtonUrl')?.trim() || '';
    const epay = await this.getEpayConfig();
    return {
      // "balance" = self-serve wallet checkout; "cdk" = buy a CDK at the shop
      // link then redeem it.
      purchaseMode: mode === 'cdk' ? 'cdk' : 'balance',
      buyButtonText: map.get('portal.buyButtonText') || '购买',
      cdkButtonText: map.get('portal.cdkButtonText') || 'cdk充值',
      cdkButtonUrl:
        configuredShopUrl === '/portal/redeem' ? '' : configuredShopUrl,
      purchaseNotice: {
        enabled: map.get('portal.purchaseNotice.enabled') === 'true',
        title: map.get('portal.purchaseNotice.title')?.trim() || '买前须知',
        content: map.get('portal.purchaseNotice.content')?.trim() || '',
      },
      checkoutMode: epay.checkoutMode,
      epayConfigured: epay.configured,
    };
  }

  async getEpayConfig(): Promise<EpayConfig> {
    const map = await this.all();
    const storedKey = map.get('epay.merchantKey');
    const paymentType = map.get('epay.paymentType');
    const gatewayUrl = map.get('epay.gatewayUrl')?.trim() || undefined;
    const merchantId = map.get('epay.merchantId')?.trim() || undefined;
    const merchantKey = storedKey ? this.cipher.decrypt(storedKey) : undefined;
    const checkoutMode: CheckoutMode =
      map.get('payment.checkoutMode') === 'epay' ? 'epay' : 'store';
    const normalizedPaymentType: EpayPaymentType =
      paymentType === 'wxpay' || paymentType === 'qqpay'
        ? paymentType
        : 'alipay';
    return {
      checkoutMode,
      gatewayUrl,
      merchantId,
      merchantKey,
      paymentType: normalizedPaymentType,
      configured: Boolean(gatewayUrl && merchantId && merchantKey),
      reconciliationReady: process.env.EPAY_RECONCILIATION_ENABLED === 'true',
    };
  }

  async prepareEpaySettingsUpdate(input: EpaySettingsUpdate) {
    const current = await this.getEpayConfig();
    const updates: Record<string, string> = {};
    const gatewayUrl =
      input.epayGatewayUrl === undefined
        ? current.gatewayUrl
        : this.normalizeEpayGatewayUrl(input.epayGatewayUrl);
    const merchantId =
      input.epayMerchantId === undefined
        ? current.merchantId
        : input.epayMerchantId.trim() || undefined;
    const merchantKey = input.epayMerchantKey?.trim() || current.merchantKey;
    const paymentType = input.epayPaymentType ?? current.paymentType;
    const checkoutMode = input.checkoutMode ?? current.checkoutMode;

    if (merchantId && !/^[A-Za-z0-9_-]{1,64}$/.test(merchantId)) {
      throw new BadRequestException('易支付商户 ID 格式不正确');
    }
    if (checkoutMode === 'epay' && !(gatewayUrl && merchantId && merchantKey)) {
      throw new BadRequestException(
        '启用易支付前请完整填写网关、商户 ID 和商户密钥',
      );
    }
    if (checkoutMode === 'epay' && current.checkoutMode !== 'epay') {
      const testedChannels = await Promise.all(
        (['alipay', 'wxpay'] as const).map((requiredPaymentType) =>
          this.prisma.epayGatewayTestAttempt.findFirst({
            where: {
              configFingerprint: this.epayConfigFingerprint({
                gatewayUrl: gatewayUrl!,
                merchantId: merchantId!,
                merchantKey: merchantKey!,
                paymentType: requiredPaymentType,
              }),
              status: EpayPaymentStatus.SETTLED,
            },
            select: { id: true },
          }),
        ),
      );
      if (testedChannels.some((tested) => !tested)) {
        throw new BadRequestException(
          '请先分别完成支付宝和微信的 0.01 元易支付测试，再切换全站购买渠道',
        );
      }
      if (!current.reconciliationReady) {
        throw new BadRequestException(
          '易支付主动查单尚未配置，当前不能切换全站购买渠道',
        );
      }
    }
    if (input.checkoutMode !== undefined) {
      updates['payment.checkoutMode'] = checkoutMode;
    }
    if (input.epayGatewayUrl !== undefined) {
      updates['epay.gatewayUrl'] = gatewayUrl ?? '';
    }
    if (input.epayMerchantId !== undefined) {
      updates['epay.merchantId'] = merchantId ?? '';
    }
    if (input.epayMerchantKey?.trim()) {
      updates['epay.merchantKey'] = input.epayMerchantKey.trim();
    }
    if (input.epayPaymentType !== undefined) {
      updates['epay.paymentType'] = paymentType;
    }
    return updates;
  }

  epayConfigFingerprint(
    config: Required<
      Pick<EpayConfig, 'gatewayUrl' | 'merchantId' | 'merchantKey'>
    > &
      Pick<EpayConfig, 'paymentType'>,
  ) {
    return createHash('sha256')
      .update(
        JSON.stringify([
          config.gatewayUrl,
          config.merchantId,
          config.merchantKey,
          config.paymentType,
        ]),
      )
      .digest('hex');
  }

  private normalizeEpayGatewayUrl(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new BadRequestException('易支付网关地址不是有效 URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new BadRequestException('易支付网关地址格式不正确');
    }
    const localHost =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (
      process.env.NODE_ENV === 'production' &&
      url.protocol !== 'https:' &&
      !localHost
    ) {
      throw new BadRequestException('生产环境的易支付网关必须使用 HTTPS');
    }
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  }

  /** OAuth credentials: DB settings take precedence, env vars are the fallback. */
  async getOAuthConfig() {
    const map = await this.all();
    const pick = (key: string, envKey: string) =>
      map.get(key) || process.env[envKey] || undefined;

    const googleSecret = map.get('oauth.google.secret');
    const githubSecret = map.get('oauth.github.secret');
    const google = {
      clientId: pick('oauth.google.id', 'GOOGLE_CLIENT_ID'),
      clientSecret: googleSecret
        ? this.cipher.decrypt(googleSecret)
        : process.env.GOOGLE_CLIENT_SECRET || undefined,
    };
    const github = {
      clientId: pick('oauth.github.id', 'GITHUB_CLIENT_ID'),
      clientSecret: githubSecret
        ? this.cipher.decrypt(githubSecret)
        : process.env.GITHUB_CLIENT_SECRET || undefined,
    };
    return {
      google: {
        ...google,
        configured: Boolean(google.clientId && google.clientSecret),
      },
      github: {
        ...github,
        configured: Boolean(github.clientId && github.clientSecret),
      },
    };
  }
}
