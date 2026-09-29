import nodemailer from 'nodemailer';
import {
  classifyMailDeliveryError,
  mailRecipientValidationMessage,
  MailService,
  CampaignDeliveryError,
} from './mail.service';

describe('MailService delivery errors', () => {
  it('preserves definitive authentication failure for the campaign queue without leaking SMTP details', async () => {
    const sendMail = jest.fn().mockRejectedValue({
      code: 'EAUTH',
      responseCode: 535,
      response: '535 private@example.test secret-token',
    });
    const transport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);
    try {
      const service = new MailService({
        getSmtpConfig: () =>
          Promise.resolve({
            configured: true,
            host: 'smtp.test',
            port: 465,
            user: 'sender@test',
            pass: 'secret',
          }),
      } as never);
      const error = await service
        .sendCampaign({
          to: 'member@example.test',
          subject: '活动',
          body: '正文',
          activityUrl: 'https://site.test',
          unsubscribeUrl: 'https://site.test/unsubscribe',
          messageId: '<test@site.test>',
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CampaignDeliveryError);
      expect(error).toMatchObject({ definitive: true, pauseQueue: true });
      expect((error as Error).message).toContain('认证');
      expect((error as Error).message).not.toMatch(/private|secret-token/);
    } finally {
      transport.mockRestore();
    }
  });
  it('requires SMTP for campaign mail instead of silently using the dev fallback', async () => {
    const service = new MailService({
      getSmtpConfig: () => Promise.resolve({ configured: false }),
    } as never);
    await expect(
      service.sendCampaign({
        to: 'member@example.test',
        subject: '活动',
        body: '内容',
        activityUrl: 'https://site.test/portal/holiday',
        unsubscribeUrl: 'https://site.test/unsubscribe',
        messageId: '<fixture@site.test>',
      }),
    ).rejects.toThrow('未发送活动邮件');
  });
  it('escapes campaign content and provides per-recipient unsubscribe and stable message IDs', async () => {
    const sendMail = jest
      .fn<
        Promise<object>,
        [
          {
            html: string;
            headers: Record<string, string>;
            messageId: string;
            to: string;
          },
        ]
      >()
      .mockResolvedValue({});
    const transport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);
    try {
      const service = new MailService({
        getSmtpConfig: () =>
          Promise.resolve({
            configured: true,
            host: 'smtp.test',
            user: 'sender@test',
            pass: 'test',
            port: 465,
          }),
      } as never);
      await service.sendCampaign({
        to: 'member@example.test',
        subject: '<img src=x>',
        body: '<script>alert(1)</script>',
        activityUrl: 'https://site.test/portal/holiday',
        unsubscribeUrl: 'https://site.test/unsubscribe/signed',
        messageId: '<fixture@site.test>',
      });
      const sent = sendMail.mock.calls[0][0];
      expect(sent.html).not.toContain('<script>');
      expect(sent.html).toContain('&lt;script&gt;');
      expect(sent.headers['List-Unsubscribe']).toBe(
        '<https://site.test/unsubscribe/signed>',
      );
      expect(sent.messageId).toBe('<fixture@site.test>');
      expect(sent.to).toBe('member@example.test');
    } finally {
      transport.mockRestore();
    }
  });
  it.each([
    [
      { responseCode: 550, response: '550 5.1.1 User unknown' },
      '邮箱地址不存在或填写有误，请检查后重试。',
    ],
    [
      {
        responseCode: 511,
        response: '511 sorry, no mailbox here by that name',
      },
      '邮箱地址不存在或填写有误，请检查后重试。',
    ],
    [
      { responseCode: 552, response: '552 5.2.2 Mailbox full' },
      '收件邮箱容量已满，请清理邮箱空间后重试。',
    ],
    [
      { responseCode: 554, response: '554 5.7.1 Message rejected by policy' },
      '收件方拒收了邮件，请将发件地址加入白名单或更换邮箱后重试。',
    ],
    [
      { code: 'EAUTH', responseCode: 535 },
      '邮件服务配置异常，请联系管理员检查发件账号。',
    ],
    [{ code: 'ETIMEDOUT' }, '邮件服务暂时无法连接，请稍后重试。'],
    [{ responseCode: 451 }, '邮件服务暂时繁忙，请稍后重试。'],
  ])('maps %# to a safe Chinese explanation', (error, expected) => {
    expect(classifyMailDeliveryError(error)).toBe(expected);
  });

  it('suggests the intended provider for common recipient-domain typos', () => {
    expect(mailRecipientValidationMessage('suxin.space@gamil.com')).toBe(
      '邮箱域名“gamil.com”疑似填写错误，请改为“gmail.com”后重试。',
    );
    expect(mailRecipientValidationMessage('suxin.space@gmail.com')).toBeNull();
  });

  it('rejects a common domain typo before contacting SMTP', async () => {
    const getSmtpConfig = jest.fn();
    const service = new MailService({ getSmtpConfig } as never);

    await expect(service.sendTest('suxin.space@gamil.com')).rejects.toThrow(
      '邮箱域名“gamil.com”疑似填写错误，请改为“gmail.com”后重试。',
    );
    expect(getSmtpConfig).not.toHaveBeenCalled();
  });

  it('does not expose the raw SMTP response to callers', async () => {
    const config = {
      configured: true,
      host: 'smtp.example.com',
      port: 465,
      user: 'sender@example.com',
      pass: 'secret',
      from: 'sender@example.com',
    };
    const service = new MailService({
      getSmtpConfig: jest.fn().mockResolvedValue(config),
    } as never);
    const sendMail = jest.fn().mockRejectedValue({
      responseCode: 550,
      response: '550 5.1.1 private-recipient@example.com User unknown',
    });
    Object.assign(service, {
      transporter: { sendMail },
      signature: `${config.host}:${config.port}:${config.user}:${config.pass}`,
    });

    const error = await service.sendTest('member@example.com').then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      '邮箱地址不存在或填写有误，请检查后重试。',
    );
    expect((error as Error).message).not.toContain(
      'private-recipient@example.com',
    );
  });
});
