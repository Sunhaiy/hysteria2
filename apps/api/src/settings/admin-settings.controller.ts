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
    const registrationEnabled = await this.settings.isRegistrationEnabled();
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
