import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { TestEmailDto, UpdateSettingsDto } from '../contracts/http.dto';
import { MailService } from '../mail/mail.service';
import { SettingsService } from './settings.service';

@Controller('api/admin/settings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  @Get()
  async getSettings() {
    const smtp = await this.settings.getSmtpConfig();
    const oauth = await this.settings.getOAuthConfig();
    const branding = await this.settings.getPortalBranding();
    const registrationEnabled = await this.settings.isRegistrationEnabled();
    const callbackBase =
      process.env.OAUTH_CALLBACK_BASE ||
      process.env.API_PUBLIC_URL ||
      'http://212.103.62.228:4000';
    return {
      smtp: {
        host: smtp.host ?? '',
        port: smtp.port,
        user: smtp.user ?? '',
        from: smtp.from ?? '',
        // Never echo the password back; only whether one is set.
        passSet: Boolean(smtp.pass),
        configured: smtp.configured,
      },
      oauth: {
        // Client IDs are not secret (they appear in the redirect); show them.
        // Secrets are write-only — only report whether they are set.
        google: {
          clientId: oauth.google.clientId ?? '',
          secretSet: Boolean(oauth.google.clientSecret),
          configured: oauth.google.configured,
          callbackUrl: `${callbackBase}/api/auth/oauth/google/callback`,
        },
        github: {
          clientId: oauth.github.clientId ?? '',
          secretSet: Boolean(oauth.github.clientSecret),
          configured: oauth.github.configured,
          callbackUrl: `${callbackBase}/api/auth/oauth/github/callback`,
        },
      },
      branding,
      registrationEnabled,
    };
  }

  @Patch()
  async updateSettings(@Body() body: UpdateSettingsDto) {
    const updates: Record<string, string> = {};
    if (body.smtpHost !== undefined) updates['smtp.host'] = body.smtpHost.trim();
    if (body.smtpPort !== undefined) updates['smtp.port'] = String(body.smtpPort);
    if (body.smtpUser !== undefined) updates['smtp.user'] = body.smtpUser.trim();
    // Only overwrite the password when a non-empty value is provided.
    if (body.smtpPass) updates['smtp.pass'] = body.smtpPass;
    if (body.smtpFrom !== undefined) updates['smtp.from'] = body.smtpFrom.trim();
    if (body.registrationEnabled !== undefined) {
      updates['registration.enabled'] = String(body.registrationEnabled);
    }
    if (body.googleClientId !== undefined) {
      updates['oauth.google.id'] = body.googleClientId.trim();
    }
    if (body.googleClientSecret) {
      updates['oauth.google.secret'] = body.googleClientSecret.trim();
    }
    if (body.githubClientId !== undefined) {
      updates['oauth.github.id'] = body.githubClientId.trim();
    }
    if (body.githubClientSecret) {
      updates['oauth.github.secret'] = body.githubClientSecret.trim();
    }
    if (body.buyButtonText !== undefined) {
      updates['portal.buyButtonText'] = body.buyButtonText.trim();
    }
    if (body.cdkButtonText !== undefined) {
      updates['portal.cdkButtonText'] = body.cdkButtonText.trim();
    }
    if (body.cdkButtonUrl !== undefined) {
      updates['portal.cdkButtonUrl'] = body.cdkButtonUrl.trim();
    }
    await this.settings.setMany(updates);
    return this.getSettings();
  }

  @Post('test-email')
  @HttpCode(200)
  async testEmail(@Body() body: TestEmailDto) {
    await this.mail.sendTest(body.to);
    return { success: true };
  }
}
