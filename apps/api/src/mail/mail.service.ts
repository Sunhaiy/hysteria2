import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.from = process.env.SMTP_FROM ?? user ?? 'no-reply@hysteria.local';

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        // 465 -> implicit TLS; 587/25 -> STARTTLS upgrade.
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`SMTP transport configured (${host}:${port})`);
    } else {
      this.logger.warn(
        'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing); ' +
          'verification codes will be logged instead of emailed.',
      );
    }
  }

  get isConfigured() {
    return this.transporter !== null;
  }

  async sendVerificationCode(email: string, code: string) {
    if (!this.transporter) {
      // Dev fallback: surface the code in logs so the flow is testable without SMTP.
      this.logger.warn(`[DEV] Verification code for ${email}: ${code}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject: 'Hysteria 2 注册验证码',
      text: `你的注册验证码是 ${code}，10 分钟内有效。如果这不是你本人操作，请忽略本邮件。`,
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a">` +
        `<p>你的 Hysteria 2 注册验证码是：</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>` +
        `<p style="color:#666">10 分钟内有效。如果这不是你本人操作，请忽略本邮件。</p>` +
        `</div>`,
    });
  }
}
