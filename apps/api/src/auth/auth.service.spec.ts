import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { compare, hashSync } from 'bcryptjs';
import { AuthService } from './auth.service';

describe('AuthService sessions', () => {
  function createService(status: 'active' | 'suspended' | 'banned') {
    const store = {
      findUserByEmail: jest.fn().mockResolvedValue({
        id: 'user_1',
        email: 'member@example.com',
        displayName: 'Member',
        passwordHash: hashSync('correct-password', 4),
        role: 'member',
        status,
        sessionVersion: 1,
      }),
      consumePasswordResetToken: jest
        .fn<Promise<boolean>, [string, string]>()
        .mockResolvedValue(true),
      issuePasswordResetToken: jest.fn().mockResolvedValue({
        id: 'reset_1',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      }),
    };
    const jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-session'),
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const mail = {
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      store as never,
      jwt as never,
      cache as never,
      mail as never,
      {} as never,
    );
    return { service, store, mail };
  }

  it.each(['suspended', 'banned'] as const)(
    'rejects a %s account even when the password is valid',
    async (status) => {
      const { service } = createService(status);

      await expect(
        service.login('member@example.com', 'correct-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('never includes a password hash in a session response', async () => {
    const { service } = createService('active');

    const response = await service.login(
      'member@example.com',
      'correct-password',
    );

    expect(response.user).not.toHaveProperty('passwordHash');
  });

  it('normalizes the login email with the same rule used by password reset', async () => {
    const { service, store } = createService('active');

    await service.login('Member@Example.com', 'correct-password');

    expect(store.findUserByEmail).toHaveBeenCalledWith('member@example.com');
  });

  it('consumes a one-time reset token without storing the raw token or password', async () => {
    const { service, store } = createService('active');

    await service.resetPassword('raw-reset-token', 'new-password-123');

    expect(store.consumePasswordResetToken).toHaveBeenCalledTimes(1);
    const [tokenHash, passwordHash] =
      store.consumePasswordResetToken.mock.calls[0];
    expect(tokenHash).toBe(
      createHash('sha256').update('raw-reset-token').digest('hex'),
    );
    await expect(compare('new-password-123', passwordHash)).resolves.toBe(true);
  });

  it('emails a hashed one-time reset token without exposing it in the response', async () => {
    const { service, store, mail } = createService('active');

    const response = await service.requestPasswordReset('Member@Example.com');

    expect(response).toEqual({
      success: true,
      message: '如果该邮箱已注册，重置链接将在几分钟内发送。',
    });
    expect(store.issuePasswordResetToken).toHaveBeenCalledTimes(1);
    const [issued] = store.issuePasswordResetToken.mock.calls[0] as unknown as [
      { userId: string; createdById: string | null; tokenHash: string },
    ];
    expect(issued).toMatchObject({ userId: 'user_1', createdById: null });
    expect(issued.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const [recipient, resetUrl] = mail.sendPasswordReset.mock
      .calls[0] as unknown as [string, string];
    expect(recipient).toBe('member@example.com');
    expect(resetUrl).toMatch(/\/reset-password\?token=/);
    expect(response).not.toHaveProperty('resetUrl');
  });

  it('returns the same response for an unknown email without issuing a token', async () => {
    const { service, store, mail } = createService('active');
    store.findUserByEmail.mockResolvedValueOnce(null);

    const response = await service.requestPasswordReset('nobody@example.com');

    expect(response).toEqual({
      success: true,
      message: '如果该邮箱已注册，重置链接将在几分钟内发送。',
    });
    expect(store.issuePasswordResetToken).not.toHaveBeenCalled();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });
});
