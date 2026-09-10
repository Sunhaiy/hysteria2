import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

const MAIL_DELIVERY_MESSAGES = {
  invalidRecipient: '邮箱地址不存在或填写有误，请检查后重试。',
  mailboxFull: '收件邮箱容量已满，请清理邮箱空间后重试。',
  rejected: '收件方拒收了邮件，请将发件地址加入白名单或更换邮箱后重试。',
  authentication: '邮件服务配置异常，请联系管理员检查发件账号。',
  connection: '邮件服务暂时无法连接，请稍后重试。',
  temporary: '邮件服务暂时繁忙，请稍后重试。',
  unknown: '邮件发送失败，请检查邮箱地址后重试。',
} as const;

type MailDeliveryError = {
  code?: unknown;
  responseCode?: unknown;
  response?: unknown;
  message?: unknown;
};

function safeErrorField(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

export function classifyMailDeliveryError(error: unknown) {
  const details = (error ?? {}) as MailDeliveryError;
  const code = safeErrorField(details.code).toUpperCase();
  const responseCode = Number(safeErrorField(details.responseCode) || 0);
  const description = `${safeErrorField(details.response)} ${safeErrorField(
    details.message,
  )}`.toLowerCase();

  if (
    /5\.2\.2|mailbox (?:is )?full|quota exceeded|over quota|storage allocation/.test(
      description,
    )
  ) {
    return MAIL_DELIVERY_MESSAGES.mailboxFull;
  }
  if (
    /5\.1\.[0136]|user unknown|no such user|does not exist|unknown recipient|invalid recipient|recipient address rejected/.test(
      description,
    )
  ) {
    return MAIL_DELIVERY_MESSAGES.invalidRecipient;
  }
  if (code === 'EAUTH' || responseCode === 534 || responseCode === 535) {
    return MAIL_DELIVERY_MESSAGES.authentication;
  }
  if (
    ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(
      code,
    )
  ) {
    return MAIL_DELIVERY_MESSAGES.connection;
  }
  if (
    /5\.7\.\d|rejected|blocked|spam|policy|not permitted|access denied/.test(
      description,
    )
  ) {
    return MAIL_DELIVERY_MESSAGES.rejected;
  }
  if (
    (responseCode >= 400 && responseCode < 500) ||
    ['EENVELOPE', 'EMESSAGE'].includes(code)
  ) {
    return MAIL_DELIVERY_MESSAGES.temporary;
  }
  return MAIL_DELIVERY_MESSAGES.unknown;
}

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

  async sendPasswordReset(email: string, resetUrl: string) {
    await this.send({
      to: email,
      subject: 'Hysteria 2 密码重置',
      text: `请在 30 分钟内打开以下链接重置密码：\n${resetUrl}\n如果这不是你本人操作，请忽略本邮件。`,
      html:
        `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a">` +
        `<p>我们收到了你的密码重置请求。</p>` +
        `<p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#16865b;color:#fff;text-decoration:none;border-radius:6px">重置密码</a></p>` +
        `<p style="color:#666">链接 30 分钟内有效且只能使用一次。如果这不是你本人操作，请忽略本邮件。</p>` +
        `</div>`,
      devNote: `[DEV] Password reset link for ${email}: ${resetUrl}`,
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

    try {
      await this.transporter.sendMail({
        from: cfg.from || cfg.user,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    } catch (error) {
      const details = (error ?? {}) as MailDeliveryError;
      this.logger.warn(
        `Email delivery failed (code=${safeErrorField(details.code) || 'unknown'}, responseCode=${safeErrorField(details.responseCode) || 'unknown'})`,
      );
      throw new ServiceUnavailableException(classifyMailDeliveryError(error));
    }
  }
}
