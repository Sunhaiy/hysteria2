import {
  classifyMailDeliveryError,
  mailRecipientValidationMessage,
  MailService,
} from './mail.service';

describe('MailService delivery errors', () => {
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
