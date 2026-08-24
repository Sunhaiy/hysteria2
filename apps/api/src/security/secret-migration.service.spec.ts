import { SecretMigrationService } from './secret-migration.service';

describe('SecretMigrationService', () => {
  const previous = process.env.SECRET_MIGRATION_ENABLED;

  afterEach(() => {
    if (previous === undefined) delete process.env.SECRET_MIGRATION_ENABLED;
    else process.env.SECRET_MIGRATION_ENABLED = previous;
  });

  it('does not rewrite existing plaintext secrets unless explicitly enabled', async () => {
    process.env.SECRET_MIGRATION_ENABLED = 'false';
    const prisma = {
      setting: { findMany: jest.fn() },
      node: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const cipher = { enabled: true, encrypt: jest.fn() };
    const service = new SecretMigrationService(
      prisma as never,
      cipher as never,
    );

    await service.onModuleInit();

    expect(prisma.setting.findMany).not.toHaveBeenCalled();
    expect(prisma.node.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
