import { AdminUsersController } from './admin-users.controller';

describe('AdminUsersController single administrator policy', () => {
  const controller = new AdminUsersController(
    { createUser: jest.fn(), patchUser: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('rejects creation of another administrator', async () => {
    await expect(
      controller.createUser({
        email: 'second-admin@example.com',
        displayName: 'Second admin',
        password: 'password123',
        role: 'admin',
      }),
    ).rejects.toThrow('single super administrator');
  });

  it('prevents the super administrator from disabling itself', async () => {
    await expect(
      controller.updateUser(
        'admin_1',
        { status: 'suspended' },
        {
          sub: 'admin_1',
          email: 'ops@example.com',
          displayName: 'Operations Admin',
          role: 'admin',
          jti: 'session_1',
          sessionVersion: 1,
        },
      ),
    ).rejects.toThrow('cannot be demoted or disabled');
  });
});
