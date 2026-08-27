import { ControlPlaneStoreService } from './control-plane.store';

describe('ControlPlaneStoreService cleanup', () => {
  it('uses independent retention windows and leaves durable usage data untouched', async () => {
    const prisma = {
      destinationImportBatch: {
        deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      onlineSnapshot: {
        deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
      },
      authEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 6 }) },
      usageRollup: { deleteMany: jest.fn() },
      manualOrder: { deleteMany: jest.fn() },
      quotaBucket: { deleteMany: jest.fn() },
      walletLedgerEntry: { deleteMany: jest.fn() },
    };
    const service = new ControlPlaneStoreService(prisma as never, {} as never);
    const now = new Date('2026-08-27T12:00:00.000Z');

    await expect(
      service.cleanupOldData(
        { destinationDays: 7, onlineDays: 7, authEventDays: 30 },
        now,
      ),
    ).resolves.toEqual({
      deletedDestinationBatches: 4,
      deletedSnapshots: 5,
      deletedAuthEvents: 6,
    });
    expect(prisma.destinationImportBatch.deleteMany).toHaveBeenCalledWith({
      where: { observedAt: { lt: new Date('2026-08-20T12:00:00.000Z') } },
    });
    expect(prisma.onlineSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { capturedAt: { lt: new Date('2026-08-20T12:00:00.000Z') } },
    });
    expect(prisma.authEvent.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-07-28T12:00:00.000Z') } },
    });
    expect(prisma.usageRollup.deleteMany).not.toHaveBeenCalled();
    expect(prisma.manualOrder.deleteMany).not.toHaveBeenCalled();
    expect(prisma.quotaBucket.deleteMany).not.toHaveBeenCalled();
    expect(prisma.walletLedgerEntry.deleteMany).not.toHaveBeenCalled();
  });
});
