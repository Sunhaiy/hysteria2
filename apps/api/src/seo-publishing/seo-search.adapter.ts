import { createSign } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { webPublicUrl } from '../common/public-url';
import { SettingsService } from '../settings/settings.service';

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type SearchConsoleMetric = {
  date: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

@Injectable()
export class SeoSearchAdapter {
  constructor(private readonly settings: SettingsService) {}

  async submitIndexNow(url: string) {
    const [enabled, key] = await Promise.all([
      this.settings.get('seo.indexNowEnabled'),
      this.settings.get('seo.indexNowKey'),
    ]);
    if (enabled !== 'true' || !key) {
      throw new BadRequestException('IndexNow 尚未启用');
    }
    const origin = webPublicUrl();
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: new URL(origin).host,
        key,
        keyLocation: `${origin}/api/seo/indexnow-key`,
        urlList: [url],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 202) {
      throw new BadGatewayException(
        `IndexNow 返回 ${response.status}：${(await response.text()).slice(0, 200)}`,
      );
    }
    return { status: response.status };
  }

  async submitGoogleSitemap() {
    const { property, accessToken } = await this.googleAccess();
    const sitemap = `${webPublicUrl()}/sitemap.xml`;
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(sitemap)}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new BadGatewayException(
        `Google Sitemap 提交失败（${response.status}）：${(await response.text()).slice(0, 240)}`,
      );
    }
    return { status: response.status, sitemap };
  }

  async fetchGoogleMetrics(startDate: string, endDate: string) {
    const { property, accessToken } = await this.googleAccess();
    const rows: SearchConsoleMetric[] = [];
    for (let startRow = 0; startRow < 100_000; startRow += 25_000) {
      const response = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ['date', 'page', 'query'],
            rowLimit: 25_000,
            startRow,
            dataState: 'final',
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) {
        throw new BadGatewayException(
          `Search Console 同步失败（${response.status}）：${(await response.text()).slice(0, 240)}`,
        );
      }
      const payload = (await response.json()) as {
        rows?: Array<{
          keys?: string[];
          clicks?: number;
          impressions?: number;
          ctr?: number;
          position?: number;
        }>;
      };
      const batch = payload.rows ?? [];
      for (const row of batch) {
        if (!row.keys?.[0] || !row.keys[1]) continue;
        rows.push({
          date: row.keys[0],
          page: row.keys[1],
          query: row.keys[2] ?? '',
          clicks: Math.round(row.clicks ?? 0),
          impressions: Math.round(row.impressions ?? 0),
          ctr: row.ctr ?? 0,
          position: row.position ?? 0,
        });
      }
      if (batch.length < 25_000) break;
    }
    return rows;
  }

  async testGoogle() {
    const end = this.dateOnly(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const metrics = await this.fetchGoogleMetrics(end, end);
    return { ok: true, rows: metrics.length };
  }

  private async googleAccess() {
    const [enabled, property, credential] = await Promise.all([
      this.settings.get('seo.googleEnabled'),
      this.settings.get('seo.googleProperty'),
      this.settings.getSecret('seo.googleServiceAccountJson'),
    ]);
    if (enabled !== 'true' || !property?.trim() || !credential?.trim()) {
      throw new BadRequestException('Google Search Console 尚未配置');
    }
    let account: ServiceAccount;
    try {
      account = JSON.parse(credential) as ServiceAccount;
    } catch {
      throw new BadRequestException('Google 服务账号 JSON 无效');
    }
    if (!account.client_email || !account.private_key) {
      throw new BadRequestException('Google 服务账号缺少邮箱或私钥');
    }
    const now = Math.floor(Date.now() / 1000);
    const header = this.base64Url({ alg: 'RS256', typ: 'JWT' });
    const claims = this.base64Url({
      iss: account.client_email,
      scope:
        'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/webmasters',
      aud: account.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3_000,
    });
    const unsigned = `${header}.${claims}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key, 'base64url');
    const tokenResponse = await fetch(
      account.token_uri || 'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${unsigned}.${signature}`,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const token = (await tokenResponse.json()) as {
      access_token?: string;
      error_description?: string;
    };
    if (!tokenResponse.ok || !token.access_token) {
      throw new BadGatewayException(
        `Google 授权失败：${token.error_description || tokenResponse.status}`,
      );
    }
    return { property: property.trim(), accessToken: token.access_token };
  }

  private base64Url(value: Record<string, unknown>) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private dateOnly(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}
