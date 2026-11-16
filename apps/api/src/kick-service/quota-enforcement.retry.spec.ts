import { QuotaEnforcementService } from './quota-enforcement.service';

describe('Quota retry prioritization and disabled endpoints', () => {
  function fixture(active = false) {
    const task = {
      id: 'task',
      userId: 'user',
      nodeId: active ? 'active' : 'disabled',
      attempts: 100,
    };
    const db = {
      node: { findMany: jest.fn().mockResolvedValue([{ id: 'active' }]) },
      nodeAccessRevocation: {
        findMany: jest.fn(
          ({ where }: { where: { nodeId: { in?: string[] } } }) =>
            Promise.resolve(
              where.nodeId.in ? (active ? [task] : []) : active ? [] : [task],
            ),
        ),
        updateMany: jest
          .fn<
            Promise<{ count: number }>,
            [{ data: { status: string; nextAttemptAt?: Date } }]
          >()
          .mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      auditLog: { create: jest.fn() },
    };
    const access = {
      getNodeAccess: jest.fn().mockResolvedValue({ allowed: false }),
    };
    const adapter = {
      getServiceStatus: jest.fn().mockResolvedValue({
        status: 'inactive',
        mainPid: 0,
        observedAt: new Date().toISOString(),
      }),
      kickUsers: jest.fn().mockResolvedValue({ kicked: 1 }),
    };
    const service = new QuotaEnforcementService(
      db as never,
      {
        getNodeForControl: () => Promise.resolve({ id: task.nodeId, active }),
      } as never,
      access as never,
      adapter as never,
    );
    return { service, db, access, adapter };
  }
  it('completes a disabled endpoint only after confirming its core is stopped', async () => {
    const { service, db, access, adapter } = fixture();
    await service.processDue();
    expect(adapter.getServiceStatus).toHaveBeenCalledTimes(1);
    expect(adapter.kickUsers).not.toHaveBeenCalled();
    expect(access.getNodeAccess).not.toHaveBeenCalled();
    expect(db.nodeAccessRevocation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED' }) as unknown,
      }),
    );
  });
  it.each(['active', 'unknown', 'stale'])(
    'does not assume a disabled node with %s runtime has disconnected users',
    async (runtime) => {
      const { service, adapter } = fixture();
      adapter.getServiceStatus.mockResolvedValue({
        status: runtime === 'stale' ? 'inactive' : runtime,
        mainPid: 0,
        observedAt:
          runtime === 'stale'
            ? '2000-01-01T00:00:00Z'
            : new Date().toISOString(),
      });
      await service.processDue();
      expect(adapter.kickUsers).toHaveBeenCalledTimes(1);
    },
  );
  it('retains unreachable disabled work with a bounded longer retry', async () => {
    const { service, db, adapter } = fixture();
    adapter.getServiceStatus.mockRejectedValue(new Error('offline'));
    adapter.kickUsers.mockRejectedValue(new Error('offline'));
    const start = Date.now();
    await service.processDue();
    const data = db.nodeAccessRevocation.updateMany.mock.calls.at(-1)![0].data;
    expect(data.status).toBe('PENDING');
    expect(data.nextAttemptAt!.getTime() - start).toBeGreaterThanOrEqual(
      3_600_000,
    );
    expect(data.nextAttemptAt!.getTime() - start).toBeLessThan(3_601_000);
  });
  it('fills the batch with active work first and still rechecks restored access', async () => {
    const { service, db, access, adapter } = fixture(true);
    access.getNodeAccess.mockResolvedValue({ allowed: true });
    await service.processDue(1);
    expect(db.nodeAccessRevocation.findMany).toHaveBeenCalledTimes(1);
    expect(
      db.nodeAccessRevocation.findMany.mock.calls[0][0].where.nodeId,
    ).toEqual({ in: ['active'] });
    expect(access.getNodeAccess).toHaveBeenCalledTimes(1);
    expect(adapter.kickUsers).not.toHaveBeenCalled();
  });
});
