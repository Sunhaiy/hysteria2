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
import { apiPublicUrl, webPublicUrl } from '../common/public-url';

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
    const site = await this.settings.getSiteInfo();
    const tutorial = await this.settings.getTutorialConfig();
    const registrationEnabled = await this.settings.isRegistrationEnabled();
    const announcement = await this.settings.getAnnouncementConfig();
    const epay = await this.settings.getEpayConfig();
    const callbackBase = process.env.OAUTH_CALLBACK_BASE || apiPublicUrl();
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
      site,
      tutorial,
      registrationEnabled,
      announcement,
      payment: {
        checkoutMode: epay.checkoutMode,
        epay: {
          gatewayUrl: epay.gatewayUrl ?? '',
          merchantId: epay.merchantId ?? '',
          merchantKeySet: Boolean(epay.merchantKey),
          paymentType: epay.paymentType,
          configured: epay.configured,
          reconciliationReady: epay.reconciliationReady,
          notifyUrl: `${apiPublicUrl()}/api/payments/epay/notify`,
          returnUrl: `${apiPublicUrl()}/api/payments/epay/return`,
          successUrl: `${webPublicUrl()}/portal/orders?payment=success`,
        },
      },
    };
  }

  @Patch()
  async updateSettings(@Body() body: UpdateSettingsDto) {
    const updates: Record<string, string> = {};
    if (body.smtpHost !== undefined)
      updates['smtp.host'] = body.smtpHost.trim();
    if (body.smtpPort !== undefined)
      updates['smtp.port'] = String(body.smtpPort);
    if (body.smtpUser !== undefined)
      updates['smtp.user'] = body.smtpUser.trim();
    // Only overwrite the password when a non-empty value is provided.
    if (body.smtpPass) updates['smtp.pass'] = body.smtpPass;
    if (body.smtpFrom !== undefined)
      updates['smtp.from'] = body.smtpFrom.trim();
    if (body.registrationEnabled !== undefined) {
      updates['registration.enabled'] = String(body.registrationEnabled);
    }
    if (body.announcementEnabled !== undefined) {
      updates['announcement.enabled'] = String(body.announcementEnabled);
    }
    if (body.announcementTitle !== undefined) {
      updates['announcement.title'] = body.announcementTitle.trim();
    }
    if (body.announcementContent !== undefined) {
      updates['announcement.content'] = body.announcementContent.trim();
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
    if (body.siteName !== undefined) {
      updates['site.name'] = body.siteName.trim();
    }
    if (body.siteDescription !== undefined) {
      updates['site.description'] = body.siteDescription.trim();
    }
    if (body.siteBrowserTitle !== undefined) {
      updates['site.browserTitle'] = body.siteBrowserTitle.trim();
    }
    if (body.siteIconUrl !== undefined) {
      updates['site.iconUrl'] = body.siteIconUrl.trim();
    }
    if (body.siteFontWeight !== undefined) {
      updates['site.fontWeight'] = String(body.siteFontWeight);
    }
    if (body.purchaseMode !== undefined) {
      updates['portal.purchaseMode'] = body.purchaseMode;
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
    if (body.purchaseNoticeEnabled !== undefined) {
      updates['portal.purchaseNotice.enabled'] = String(
        body.purchaseNoticeEnabled,
      );
    }
    if (body.purchaseNoticeTitle !== undefined) {
      updates['portal.purchaseNotice.title'] = body.purchaseNoticeTitle.trim();
    }
    if (body.purchaseNoticeContent !== undefined) {
      updates['portal.purchaseNotice.content'] =
        body.purchaseNoticeContent.trim();
    }
    if (body.ultraPurchaseNoticeEnabled !== undefined) {
      updates['portal.ultraPurchaseNotice.enabled'] = String(
        body.ultraPurchaseNoticeEnabled,
      );
    }
    if (body.ultraPurchaseNoticeTitle !== undefined) {
      updates['portal.ultraPurchaseNotice.title'] =
        body.ultraPurchaseNoticeTitle.trim();
    }
    if (body.ultraPurchaseNoticeContent !== undefined) {
      updates['portal.ultraPurchaseNotice.content'] =
        body.ultraPurchaseNoticeContent.trim();
    }
    Object.assign(updates, await this.settings.prepareEpaySettingsUpdate(body));
    if (body.tutorialWindowsClient !== undefined)
      updates['tutorial.windows.client'] = body.tutorialWindowsClient.trim();
    if (body.tutorialWindowsSteps !== undefined)
      updates['tutorial.windows.steps'] = body.tutorialWindowsSteps.trim();
    if (body.tutorialWindowsUrl !== undefined)
      updates['tutorial.windows.url'] = body.tutorialWindowsUrl.trim();
    if (body.tutorialAndroidClient !== undefined)
      updates['tutorial.android.client'] = body.tutorialAndroidClient.trim();
    if (body.tutorialAndroidSteps !== undefined)
      updates['tutorial.android.steps'] = body.tutorialAndroidSteps.trim();
    if (body.tutorialAndroidUrl !== undefined)
      updates['tutorial.android.url'] = body.tutorialAndroidUrl.trim();
    if (body.tutorialIosClient !== undefined)
      updates['tutorial.ios.client'] = body.tutorialIosClient.trim();
    if (body.tutorialIosSteps !== undefined)
      updates['tutorial.ios.steps'] = body.tutorialIosSteps.trim();
    if (body.tutorialIosUrl !== undefined)
      updates['tutorial.ios.url'] = body.tutorialIosUrl.trim();
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
