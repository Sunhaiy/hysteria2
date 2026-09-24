import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ControlPlaneStoreService } from '../src/domain/control-plane.store';
import { recordRedemptionUse } from '../src/commerce/redemption-usage';

const url = process.env.CDK_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'CDK limits with PostgreSQL transactions',
  () => {
    let db: PrismaClient;
    let store: ControlPlaneStoreService;
    beforeAll(() => {
      const target = new URL(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.pathname !== '/cdk_limit_test'
      )
        throw new Error('Use the isolated local cdk_limit_test database');
      db = new PrismaClient({ datasources: { db: { url } } });
      store = new ControlPlaneStoreService(db as never, {} as never);
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    const user = () =>
      db.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          displayName: 'Local test',
          passwordHash: 'not-a-real-password',
        },
      });
    const code = (maxUses: number, maxUsesPerUser: number) =>
      db.redemptionCode.create({
        data: {
          code: randomUUID().toUpperCase(),
          label: 'Local limit test',
          kind: 'BALANCE',
          amountCents: 100,
          maxUses,
          maxUsesPerUser,
        },
      });

    it('credits each allowed use, rejects the third per user, and shares the global total across users', async () => {
      const a = await user(),
        b = await user(),
        c = await code(3, 2);
      await store.redeemRedemptionCode(a.id, c.code);
      await store.redeemRedemptionCode(a.id, c.code);
      await expect(store.redeemRedemptionCode(a.id, c.code)).rejects.toThrow(
        '每人使用次数上限',
      );
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: a.id } })).balanceCents,
      ).toBe(200);
      await store.redeemRedemptionCode(b.id, c.code);
      await expect(store.redeemRedemptionCode(b.id, c.code)).rejects.toThrow(
        '已用完',
      );
      expect(await db.redemptionUse.count({ where: { codeId: c.id } })).toBe(3);
      expect(
        (await db.redemptionCode.findUniqueOrThrow({ where: { id: c.id } }))
          .usedCount,
      ).toBe(3);
    });

    it('allows raising an existing per-user limit without clearing history', async () => {
      const a = await user(),
        c = await code(10, 1);
      await store.redeemRedemptionCode(a.id, c.code);
      await store.patchRedemptionCode(c.id, { maxUsesPerUser: 2 });
      await store.redeemRedemptionCode(a.id, c.code);
      await store.patchRedemptionCode(c.id, { maxUsesPerUser: 1 });
      await expect(store.redeemRedemptionCode(a.id, c.code)).rejects.toThrow(
        '每人使用次数上限',
      );
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: a.id } })).balanceCents,
      ).toBe(200);
    });

    it('does not exceed the personal cap under simultaneous balance redemptions', async () => {
      const a = await user(),
        c = await code(10, 1);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          store.redeemRedemptionCode(a.id, c.code),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: a.id } })).balanceCents,
      ).toBe(100);
      expect(
        (await db.redemptionCode.findUniqueOrThrow({ where: { id: c.id } }))
          .usedCount,
      ).toBe(1);
    });

    it('rolls back both credit and use counts when fulfillment fails', async () => {
      const a = await user(),
        c = await code(10, 2);
      await expect(
        store.redeemRedemptionCode(a.id, c.code, undefined, async () => {
          throw new Error('fulfillment failed');
        }),
      ).rejects.toThrow();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: a.id } })).balanceCents,
      ).toBe(0);
      expect(
        (await db.redemptionCode.findUniqueOrThrow({ where: { id: c.id } }))
          .usedCount,
      ).toBe(0);
      expect(await db.redemptionUse.count({ where: { codeId: c.id } })).toBe(0);
      await store.redeemRedemptionCode(a.id, c.code);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: a.id } })).balanceCents,
      ).toBe(100);
    });

    it('protects the global last use across different users', async () => {
      const a = await user(),
        b = await user(),
        c = await code(1, 2);
      const results = await Promise.allSettled(
        [a, b].map((u) => store.redeemRedemptionCode(u.id, c.code)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.redemptionUse.count({ where: { codeId: c.id } })).toBe(1);
      const balances = await db.user.findMany({
        where: { id: { in: [a.id, b.id] } },
      });
      expect(balances.reduce((sum, u) => sum + u.balanceCents, 0)).toBe(100);
    });

    it('serializes recording under read-committed transactions as used by legacy discount checkout', async () => {
      const a = await user(),
        c = await code(10, 2);
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          db.$transaction((tx) =>
            recordRedemptionUse(tx, { codeId: c.id, userId: a.id }),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const uses = await db.redemptionUse.findMany({
        where: { codeId: c.id },
        orderBy: { useNumber: 'asc' },
      });
      expect(uses.map((entry) => entry.useNumber)).toEqual([1, 2]);
    });
  },
);
