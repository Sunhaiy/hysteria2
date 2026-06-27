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

  /** Public site identity (name shown in the sidebar/login, optional tagline). */
  async getSiteInfo() {
    const map = await this.all();
    return {
      name: map.get('site.name') || 'Hysteria 2',
      description: map.get('site.description') || '',
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
