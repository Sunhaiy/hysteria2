import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private signature = '';

  constructor(private readonly settings: SettingsService) {}

  async isConfigured() {
    return (await this.settings.getSmtpConfig()).configured;
  }

  async sendVerificationCode(email: string, code: string) {
    await this.send({
      to: email,
      subject: 'Hysteria 2 注册验证码',
      text: `你的注册验证码是 ${code}，10 分钟内有效。如果这不是你本人操作，请忽略本邮件。`,
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a">` +
        `<p>你的 Hysteria 2 注册验证码是：</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
        `<p style="color:#666">10 分钟内有效。如果这不是你本人操作，请忽略本邮件。</p>` +
        `</div>`,
      devNote: `[DEV] Verification code for ${email}: ${code}`,
    });
  }

  async sendTest(email: string) {
    await this.send({
      to: email,
      subject: 'Hysteria 2 邮件配置测试',
      text: '这是一封来自 Hysteria 2 控制台的测试邮件，收到说明 SMTP 配置正确。',
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a">` +
        `<p>这是一封来自 <b>Hysteria 2 控制台</b> 的测试邮件。</p>` +
        `<p>收到本邮件说明 SMTP 配置正确，可以正常发送注册验证码。</p>` +
        `</div>`,
      devNote: `[DEV] Test email requested for ${email} (SMTP not configured)`,
    });
  }

  async sendOperationalAlert(input: {
    to: string;
    title: string;
    message: string;
    state: 'opened' | 'resolved';
  }) {
    const stateLabel = input.state === 'opened' ? '已开启' : '已恢复';
    await this.send({
      to: input.to,
      subject: `[Hysteria 2 告警${stateLabel}] ${input.title}`,
      text: `${input.title}\n${input.message}\n状态：${stateLabel}`,
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a">` +
        `<h2>${input.title}</h2><p>${input.message}</p>` +
        `<p><b>状态：</b>${stateLabel}</p></div>`,
      devNote: `[DEV] Alert ${input.state} for ${input.to}: ${input.title}`,
    });
  }

  private async send(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    devNote: string;
  }) {
    const cfg = await this.settings.getSmtpConfig();
    if (!cfg.configured || !cfg.host || !cfg.user || !cfg.pass) {
      // Dev fallback: surface in logs so the flow stays testable without SMTP.
      this.logger.warn(input.devNote);
      return;
    }

    // Rebuild the transporter only when the SMTP config actually changes, so
    // admin edits take effect without a process restart.
    const signature = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.pass}`;
    if (!this.transporter || this.signature !== signature) {
      this.transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465, // 465 implicit TLS, 587/25 STARTTLS
        auth: { user: cfg.user, pass: cfg.pass },
      });
      this.signature = signature;
    }

    await this.transporter.sendMail({
      from: cfg.from || cfg.user,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }
}
