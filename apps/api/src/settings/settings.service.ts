import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SmtpConfig {
  host?: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
  configured: boolean;
}

export type TutorialUploadPlatform = 'windows' | 'android';

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
    client: 'v2rayN',
    steps: [
      '下载并安装 v2rayN 客户端',
      '打开「接入信息」，复制一键订阅链接',
      '在 v2rayN 的订阅分组中添加订阅地址',
      '更新订阅，选择节点并启用系统代理',
    ],
  },
  android: {
    name: 'Android',
    meta: '手机 / 平板',
    client: 'Hiddify',
    steps: [
      '下载并安装 Hiddify 客户端',
      '打开「接入信息」，复制一键订阅链接',
      '在 Hiddify 中从剪贴板添加配置',
      '选择节点，允许 VPN 权限并开始连接',
    ],
  },
  ios: {
    name: 'iOS',
    meta: 'iPhone / iPad',
    client: 'sing-box',
    steps: [
      '从 App Store 安装 sing-box 客户端',
      '打开「接入信息」，复制订阅或配置地址',
      '在 sing-box 中添加远程配置',
      '允许 VPN 权限并启动连接',
    ],
  },
} as const;

@Injectable()
export class SettingsService {
  private cache: Map<string, string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async all(): Promise<Map<string, string>> {
    if (this.cache) {
      return this.cache;
    }
    const rows = await this.prisma.setting.findMany();
    this.cache = new Map(rows.map((row) => [row.key, row.value]));
    return this.cache;
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.all()).get(key);
  }

  async setMany(updates: Record<string, string>) {
    for (const [key, value] of Object.entries(updates)) {
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    this.cache = null; // invalidate so the next read reflects the change
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
    const pass = pick('smtp.pass', 'SMTP_PASS');
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

  /** Public site identity used by the UI and browser chrome. */
  async getSiteInfo() {
    const map = await this.all();
    const name = map.get('site.name') || 'Hysteria 2';
    return {
      name,
      description: map.get('site.description') || '',
      browserTitle: map.get('site.browserTitle') || name,
      iconUrl: map.get('site.iconUrl') || '/favicon.ico',
    };
  }

  /** Portal button labels, purchase mode, and the CDK/shop link. */
  async getPortalBranding() {
    const map = await this.all();
    const mode = map.get('portal.purchaseMode');
    return {
      // "balance" = self-serve wallet checkout; "cdk" = buy a CDK at the shop
      // link then redeem it.
      purchaseMode: mode === 'cdk' ? 'cdk' : 'balance',
      buyButtonText: map.get('portal.buyButtonText') || '购买',
      cdkButtonText: map.get('portal.cdkButtonText') || 'cdk充值',
      cdkButtonUrl: map.get('portal.cdkButtonUrl') || '/portal/redeem',
    };
  }

  /** OAuth credentials: DB settings take precedence, env vars are the fallback. */
  async getOAuthConfig() {
    const map = await this.all();
    const pick = (key: string, envKey: string) =>
      map.get(key) || process.env[envKey] || undefined;

    const google = {
      clientId: pick('oauth.google.id', 'GOOGLE_CLIENT_ID'),
      clientSecret: pick('oauth.google.secret', 'GOOGLE_CLIENT_SECRET'),
    };
    const github = {
      clientId: pick('oauth.github.id', 'GITHUB_CLIENT_ID'),
      clientSecret: pick('oauth.github.secret', 'GITHUB_CLIENT_SECRET'),
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
