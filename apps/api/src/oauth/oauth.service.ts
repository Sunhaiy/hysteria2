import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../cache/cache.service';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../settings/settings.service';
import { apiPublicUrl, webPublicUrl } from '../common/public-url';

type Provider = 'google' | 'github';

interface OAuthProfile {
  email: string;
  displayName: string;
}

const STATE_TTL = 600; // 10 min
const CODE_TTL = 120; // 2 min one-time exchange code

@Injectable()
export class OAuthService {
  constructor(
    private readonly cache: CacheService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  private apiBase() {
    return (
      process.env.OAUTH_CALLBACK_BASE?.replace(/\/$/, '') || apiPublicUrl()
    );
  }

  webBase() {
    return webPublicUrl();
  }

  private redirectUri(provider: Provider) {
    return `${this.apiBase()}/api/auth/oauth/${provider}/callback`;
  }

  private async credentials(provider: Provider) {
    const cfg = await this.settings.getOAuthConfig();
    const entry = provider === 'google' ? cfg.google : cfg.github;
    return { id: entry.clientId, secret: entry.clientSecret };
  }

  async providersStatus() {
    const cfg = await this.settings.getOAuthConfig();
    return {
      google: cfg.google.configured,
      github: cfg.github.configured,
    };
  }

  private assertProvider(provider: string): asserts provider is Provider {
    if (provider !== 'google' && provider !== 'github') {
      throw new BadRequestException('不支持的登录方式');
    }
  }

  async buildAuthorizeUrl(provider: string) {
    this.assertProvider(provider);
    const { id } = await this.credentials(provider);
    if (!id) {
      throw new BadRequestException('该第三方登录尚未配置');
    }

    const state = randomUUID();
    await this.cache.set(`oauth-state:${state}`, provider, STATE_TTL);

    const redirectUri = this.redirectUri(provider);
    if (provider === 'google') {
      const params = new URLSearchParams({
        client_id: id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /** Exchange the provider code for a profile, log in, return a one-time code. */
  async handleCallback(provider: string, code?: string, state?: string) {
    this.assertProvider(provider);
    if (!code || !state) {
      throw new BadRequestException('缺少授权参数');
    }

    const expectedProvider = await this.cache.get(`oauth-state:${state}`);
    if (expectedProvider !== provider) {
      throw new BadRequestException('登录状态校验失败，请重试');
    }
    await this.cache.del(`oauth-state:${state}`);

    const profile =
      provider === 'google'
        ? await this.fetchGoogleProfile(code)
        : await this.fetchGithubProfile(code);

    const session = await this.auth.oauthLogin(profile);

    const oneTime = randomUUID();
    await this.cache.set(
      `oauth-code:${oneTime}`,
      JSON.stringify(session),
      CODE_TTL,
    );
    return oneTime;
  }

  async exchange(
    oneTime: string,
  ): Promise<Awaited<ReturnType<AuthService['oauthLogin']>>> {
    if (!oneTime) {
      throw new BadRequestException('缺少交换码');
    }
    const raw = await this.cache.get(`oauth-code:${oneTime}`);
    if (!raw) {
      throw new BadRequestException('登录已过期，请重新登录');
    }
    await this.cache.del(`oauth-code:${oneTime}`);
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('accessToken' in parsed) ||
      typeof parsed.accessToken !== 'string'
    ) {
      throw new BadRequestException('Invalid OAuth exchange payload');
    }
    return parsed as Awaited<ReturnType<AuthService['oauthLogin']>>;
  }

  private async fetchGoogleProfile(code: string): Promise<OAuthProfile> {
    const { id, secret } = await this.credentials('google');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: id ?? '',
        client_secret: secret ?? '',
        redirect_uri: this.redirectUri('google'),
        grant_type: 'authorization_code',
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new BadRequestException('Google 授权失败');
    }
    const profRes = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const prof = (await profRes.json()) as {
      email?: string;
      name?: string;
    };
    if (!prof.email) {
      throw new BadRequestException('无法获取 Google 邮箱');
    }
    return { email: prof.email, displayName: prof.name || prof.email };
  }

  private async fetchGithubProfile(code: string): Promise<OAuthProfile> {
    const { id, secret } = await this.credentials('github');
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          code,
          client_id: id ?? '',
          client_secret: secret ?? '',
          redirect_uri: this.redirectUri('github'),
        }),
      },
    );
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new BadRequestException('GitHub 授权失败');
    }
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      'User-Agent': 'hysteria2-control-plane',
      Accept: 'application/vnd.github+json',
    };
    const userRes = await fetch('https://api.github.com/user', { headers });
    const user = (await userRes.json()) as {
      login?: string;
      name?: string;
      email?: string | null;
    };
    let email = user.email ?? undefined;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers,
      });
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const picked =
        emails.find((e) => e.primary && e.verified) ||
        emails.find((e) => e.verified);
      email = picked?.email;
    }
    if (!email) {
      throw new BadRequestException(
        '无法获取 GitHub 邮箱，请在 GitHub 邮箱设置中保留一个已验证邮箱',
      );
    }
    return { email, displayName: user.name || user.login || email };
  }
}
