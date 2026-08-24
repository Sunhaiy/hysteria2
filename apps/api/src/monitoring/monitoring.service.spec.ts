import { MonitoringService } from './monitoring.service';

interface AlertState {
  id: string;
  fingerprint: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  failureCount: number;
  successCount: number;
  metadata: Record<string, unknown> | null;
  resolvedAt?: Date | null;
  events?: unknown;
}

type AlertMutation = Partial<Omit<AlertState, 'id' | 'fingerprint'>>;

describe('MonitoringService', () => {
  it('opens and resolves a deduplicated critical alert after two consecutive checks', async () => {
    let deniedAuth = 20;
    const alerts = new Map<string, AlertState>();
    const findById = (id: string) =>
      [...alerts.values()].find((alert) => alert.id === id);
    const prisma = {
      node: { findMany: jest.fn().mockResolvedValue([]) },
      usageImportBatch: { count: jest.fn().mockResolvedValue(0) },
      authEvent: {
        count: jest.fn().mockImplementation(() => Promise.resolve(deniedAuth)),
      },
      nodePool: { findMany: jest.fn().mockResolvedValue([]) },
      nodeServiceCheck: {
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      monitorAlert: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { fingerprint: string } }) =>
            Promise.resolve(alerts.get(where.fingerprint) ?? null),
          ),
        upsert: jest
          .fn()
          .mockImplementation(
            ({
              where,
              create,
              update,
            }: {
              where: { fingerprint: string };
              create: AlertMutation;
              update: AlertMutation;
            }) => {
              const existing = alerts.get(where.fingerprint);
              const values = existing ? update : create;
              const alert: AlertState = {
                id: existing?.id ?? 'alert_auth',
                fingerprint: where.fingerprint,
                kind: values.kind ?? existing?.kind ?? '',
                severity: values.severity ?? existing?.severity ?? 'CRITICAL',
                status: values.status ?? existing?.status ?? 'RESOLVED',
                title: values.title ?? existing?.title ?? '',
                message: values.message ?? existing?.message ?? '',
                failureCount:
                  values.failureCount ?? existing?.failureCount ?? 0,
                successCount:
                  values.successCount ?? existing?.successCount ?? 0,
                metadata:
                  values.metadata === undefined
                    ? (existing?.metadata ?? null)
                    : values.metadata,
                resolvedAt:
                  values.resolvedAt === undefined
                    ? existing?.resolvedAt
                    : values.resolvedAt,
                events: values.events,
              };
              alerts.set(where.fingerprint, alert);
              return Promise.resolve(alert);
            },
          ),
        update: jest
          .fn()
          .mockImplementation(
            ({
              where,
              data,
            }: {
              where: { id: string };
              data: AlertMutation;
            }) => {
              const existing = findById(where.id);
              if (!existing) throw new Error('Alert not found');
              const alert: AlertState = {
                ...existing,
                ...data,
                id: existing.id,
                fingerprint: existing.fingerprint,
                metadata:
                  data.metadata === undefined
                    ? existing.metadata
                    : data.metadata,
              };
              alerts.set(existing.fingerprint, alert);
              return Promise.resolve(alert);
            },
          ),
        findMany: jest
          .fn()
          .mockImplementation(() => Promise.resolve([...alerts.values()])),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'admin_1',
          email: 'ops@example.com',
        }),
      },
    };
    const mail = {
      sendOperationalAlert: jest
        .fn()
        .mockRejectedValueOnce(new Error('SMTP unavailable'))
        .mockResolvedValue(undefined),
    };
    const service = new MonitoringService(prisma as never, mail as never);

    await service.runChecks(new Date('2027-01-01T00:00:00.000Z'));
    expect(alerts.get('auth-rejection-anomaly:global')).toMatchObject({
      status: 'RESOLVED',
      failureCount: 1,
    });
    expect(mail.sendOperationalAlert).not.toHaveBeenCalled();

    await service.runChecks(new Date('2027-01-01T00:01:00.000Z'));
    expect(alerts.get('auth-rejection-anomaly:global')).toMatchObject({
      status: 'OPEN',
      failureCount: 2,
      successCount: 0,
      metadata: { notificationPending: null },
    });
    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(2);
    expect(mail.sendOperationalAlert).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'opened', to: 'ops@example.com' }),
    );

    deniedAuth = 0;
    await service.runChecks(new Date('2027-01-01T00:02:00.000Z'));
    expect(alerts.get('auth-rejection-anomaly:global')).toMatchObject({
      status: 'OPEN',
      failureCount: 0,
      successCount: 1,
    });

    await service.runChecks(new Date('2027-01-01T00:03:00.000Z'));
    expect(alerts.get('auth-rejection-anomaly:global')).toMatchObject({
      status: 'RESOLVED',
      successCount: 2,
    });
    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(3);
    expect(mail.sendOperationalAlert).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'resolved', to: 'ops@example.com' }),
    );
    expect(alerts.size).toBe(1);
  });
});
