import { ReportSnapshotService } from './report-snapshot.service';

describe('report snapshots', () => {
  function setup() {
    const values = new Map<string, string>();
    const cache = {
      get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      }),
    };
    return new ReportSnapshotService(cache as never);
  }

  it('serves saved data without waiting for an unavailable database', async () => {
    const service = setup();
    await service.refresh('month', () => Promise.resolve({ bytes: 123 }));
    await expect(
      service.refresh(
        'month',
        () => Promise.reject(new Error('offline')),
        true,
      ),
    ).rejects.toThrow('offline');
    expect(await service.read('month')).toMatchObject({
      data: { bytes: 123 },
      status: 'ready',
    });
  });

  it('does not report a missing snapshot as zero consumption', async () => {
    expect(await setup().read('missing')).toMatchObject({
      data: null,
      status: 'pending',
    });
  });

  it('coalesces concurrent refreshes and reuses statistics for thirty minutes', async () => {
    const service = setup();
    const query = jest.fn(() => Promise.resolve({ bytes: 42 }));
    await Promise.all([
      service.refresh('month', query),
      service.refresh('month', query),
    ]);
    await service.refresh('month', query);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
