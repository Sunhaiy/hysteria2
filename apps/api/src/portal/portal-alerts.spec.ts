import { buildPortalAlerts } from './portal-alerts';

const GB = 1024 ** 3;

function overview(remainingBytes: number, endsAt = '2026-08-30T00:00:00.000Z') {
  return {
    remainingBytes,
    subscription: {
      includedTrafficBytes: 100 * GB,
      bonusTrafficBytes: 0,
      endsAt,
    },
    packs: [],
  };
}

describe('buildPortalAlerts', () => {
  const now = new Date('2026-08-22T00:00:00.000Z');

  it.each([
    [20 * GB, 'traffic_80', 'warning'],
    [5 * GB, 'traffic_95', 'critical'],
    [0, 'traffic_100', 'critical'],
  ] as const)(
    'selects the highest crossed traffic threshold for %s remaining bytes',
    (remainingBytes, id, severity) => {
      expect(buildPortalAlerts(overview(remainingBytes), now)).toEqual([
        expect.objectContaining({ id, severity, kind: 'traffic' }),
      ]);
    },
  );

  it('does not warn below 80 percent usage', () => {
    expect(buildPortalAlerts(overview(21 * GB), now)).toEqual([]);
  });

  it('adds a separate expiry alert when three days or less remain', () => {
    const alerts = buildPortalAlerts(
      overview(50 * GB, '2026-08-24T12:00:00.000Z'),
      now,
    );

    expect(alerts).toEqual([
      expect.objectContaining({ id: 'subscription_expiry', kind: 'expiry' }),
    ]);
  });
});
