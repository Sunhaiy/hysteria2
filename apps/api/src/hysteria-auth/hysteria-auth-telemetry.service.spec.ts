import { HysteriaAuthTelemetryService } from './hysteria-auth-telemetry.service';

describe('HysteriaAuthTelemetryService', () => {
  it('persists an observation and last-use time together when storage is available', async () => {
    const update = jest
      .fn<
        Promise<object>,
        [{ where: { id: string }; data: { lastUsedAt: Date } }]
      >()
      .mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({});
    const database = {
      $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          $executeRaw: () => Promise.resolve(0),
          accessToken: { update },
          authEvent: { create },
        }),
    };
    const telemetry = new HysteriaAuthTelemetryService(database as never);
    const observation = {
      userId: 'user',
      accessTokenId: 'token',
      nodeId: 'node',
      granted: true,
      reason: 'ok',
      submittedTokenPreview: 'redacted-preview',
    };
    telemetry.record(observation);
    await telemetry.onModuleDestroy();
    expect(create).toHaveBeenCalledWith({ data: observation });
    expect(update.mock.calls[0][0].where).toEqual({ id: 'token' });
    expect(update.mock.calls[0][0].data.lastUsedAt).toBeInstanceOf(Date);
  });

  it('can admit a new observation after storage failures', async () => {
    const observations: string[] = [];
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
        work({
          $executeRaw: () => Promise.resolve(0),
          authEvent: {
            create: ({ data }: { data: { reason: string } }) => {
              observations.push(data.reason);
              return Promise.resolve();
            },
          },
        }),
      );
    const telemetry = new HysteriaAuthTelemetryService({
      $transaction: transaction,
    } as never);
    telemetry.record({ granted: false, reason: 'first' });
    telemetry.record({ granted: false, reason: 'second' });
    await new Promise((resolve) => setImmediate(resolve));
    telemetry.record({ granted: false, reason: 'after-recovery' });
    await telemetry.onModuleDestroy();
    expect(observations).toEqual(['after-recovery']);
  });
});
