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
    };
    const jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-session'),
    };
    const cache = {
      set: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      store as never,
      jwt as never,
      cache as never,
      {} as never,
      {} as never,
    );
    return { service, store };
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
});
