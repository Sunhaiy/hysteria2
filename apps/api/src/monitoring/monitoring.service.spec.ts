import { MonitoringService } from './monitoring.service';

interface AlertState {
  id: string;
  fingerprint: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  nodeId?: string | null;
  failureCount: number;
  successCount: number;
  metadata: Record<string, unknown> | null;
  resolvedAt?: Date | null;
  events?: unknown;
}

type AlertMutation = Partial<Omit<AlertState, 'id' | 'fingerprint'>>;

function createFixture(input?: {
  nodes?: unknown[];
  deniedAuth?: number;
  sendOperationalAlert?: jest.Mock;
}) {
  let deniedAuth = input?.deniedAuth ?? 0;
  const alerts = new Map<string, AlertState>();
  const findById = (id: string) =>
    [...alerts.values()].find((alert) => alert.id === id);
  const prisma = {
    node: { findMany: jest.fn().mockResolvedValue(input?.nodes ?? []) },
    usageImportBatch: { count: jest.fn().mockResolvedValue(0) },
    authEvent: {
      count: jest.fn().mockImplementation(() => Promise.resolve(deniedAuth)),
    },
    nodeServiceCheck: {
      create: jest.fn().mockResolvedValue(undefined),
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
              id: existing?.id ?? `alert_${alerts.size + 1}`,
              fingerprint: where.fingerprint,
              kind: values.kind ?? existing?.kind ?? '',
              severity: values.severity ?? existing?.severity ?? 'CRITICAL',
              status: values.status ?? existing?.status ?? 'RESOLVED',
              title: values.title ?? existing?.title ?? '',
              message: values.message ?? existing?.message ?? '',
              nodeId:
                values.nodeId === undefined
                  ? (existing?.nodeId ?? null)
                  : values.nodeId,
              failureCount: values.failureCount ?? existing?.failureCount ?? 0,
              successCount: values.successCount ?? existing?.successCount ?? 0,
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
          ({ where, data }: { where: { id: string }; data: AlertMutation }) => {
            const existing = findById(where.id);
            if (!existing) throw new Error('Alert not found');
            const alert: AlertState = {
              ...existing,
              ...data,
              id: existing.id,
              fingerprint: existing.fingerprint,
              metadata:
                data.metadata === undefined ? existing.metadata : data.metadata,
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
    sendOperationalAlert:
      input?.sendOperationalAlert ?? jest.fn().mockResolvedValue(undefined),
  };
  return {
    alerts,
    mail,
    service: new MonitoringService(prisma as never, mail as never),
    setDeniedAuth: (value: number) => {
      deniedAuth = value;
    },
  };
}

describe('MonitoringService', () => {
  it('opens and resolves a deduplicated critical alert after two consecutive checks', async () => {
    const sendOperationalAlert = jest
      .fn()
      .mockRejectedValueOnce(new Error('SMTP unavailable'))
      .mockResolvedValue(undefined);
    const { alerts, mail, service, setDeniedAuth } = createFixture({
      deniedAuth: 20,
      sendOperationalAlert,
    });

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
    });
    expect(
      alerts.get('auth-rejection-anomaly:global')?.metadata
        ?.notificationPending,
    ).toBeNull();
    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(2);
    expect(mail.sendOperationalAlert).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'opened', to: 'ops@example.com' }),
    );

    setDeniedAuth(0);
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

  it('sends one email per node incident and resets notification after recovery', async () => {
    const staleAt = new Date('2027-01-01T00:00:00.000Z');
    const node = {
      id: 'node_1',
      label: 'US-01',
      active: true,
      lifecycleStatus: 'ACTIVE',
      lastSyncAt: staleAt,
      lastSyncError: 'agent timeout' as string | null,
      capacityUsers: null,
      destinationTelemetryEnabled: false,
      serviceChecks: [],
      onlinePresence: [],
      healthSnapshots: [
        {
          checkedAt: staleAt,
          agentReachable: false,
          coreHealthy: false,
          publicEndpointReachable: false,
          latencyMs: null,
          error: 'agent timeout',
          presenceAt: staleAt,
          userSyncAt: staleAt,
          trafficAt: staleAt,
        },
      ],
    };
    const { mail, service } = createFixture({
      nodes: [node],
    });

    await service.runChecks(new Date('2027-01-01T00:04:00.000Z'));
    await service.runChecks(new Date('2027-01-01T00:05:00.000Z'));

    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(1);
    expect(mail.sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'opened', to: 'ops@example.com' }),
    );

    const recoveredAt = new Date('2027-01-01T00:06:00.000Z');
    node.lastSyncAt = recoveredAt;
    node.lastSyncError = null;
    Object.assign(node.healthSnapshots[0], {
      checkedAt: recoveredAt,
      agentReachable: true,
      coreHealthy: true,
      publicEndpointReachable: true,
      presenceAt: recoveredAt,
      userSyncAt: recoveredAt,
      trafficAt: recoveredAt,
    });
    await service.runChecks(recoveredAt);
    await service.runChecks(new Date('2027-01-01T00:07:00.000Z'));

    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(2);
    expect(mail.sendOperationalAlert).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'resolved', to: 'ops@example.com' }),
    );

    node.lastSyncAt = staleAt;
    node.lastSyncError = 'agent timeout';
    Object.assign(node.healthSnapshots[0], {
      checkedAt: staleAt,
      agentReachable: false,
      coreHealthy: false,
      publicEndpointReachable: false,
      presenceAt: staleAt,
      userSyncAt: staleAt,
      trafficAt: staleAt,
    });
    await service.runChecks(new Date('2027-01-01T00:10:00.000Z'));
    await service.runChecks(new Date('2027-01-01T00:11:00.000Z'));

    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(3);
    expect(mail.sendOperationalAlert).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'opened', to: 'ops@example.com' }),
    );
  });

  it('does not reopen an incident when critical checks hand off in the same cycle', async () => {
    const firstFailureAt = new Date('2027-01-01T00:04:00.000Z');
    const node = {
      id: 'node_1',
      label: 'US-01',
      active: true,
      lifecycleStatus: 'ACTIVE',
      lastSyncAt: firstFailureAt,
      lastSyncError: null,
      capacityUsers: null,
      destinationTelemetryEnabled: false,
      serviceChecks: [],
      onlinePresence: [],
      healthSnapshots: [
        {
          checkedAt: firstFailureAt,
          agentReachable: false,
          coreHealthy: true,
          publicEndpointReachable: true,
          latencyMs: null,
          error: null,
          presenceAt: firstFailureAt,
          userSyncAt: firstFailureAt,
          trafficAt: firstFailureAt,
        },
      ],
    };
    const { mail, service } = createFixture({ nodes: [node] });

    await service.runChecks(firstFailureAt);
    await service.runChecks(new Date('2027-01-01T00:05:00.000Z'));
    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(1);

    const handoffAt = new Date('2027-01-01T00:06:00.000Z');
    node.lastSyncAt = handoffAt;
    Object.assign(node.healthSnapshots[0], {
      checkedAt: handoffAt,
      agentReachable: true,
      presenceAt: handoffAt,
      userSyncAt: handoffAt,
      trafficAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    await service.runChecks(handoffAt);
    await service.runChecks(new Date('2027-01-01T00:07:00.000Z'));

    expect(mail.sendOperationalAlert).toHaveBeenCalledTimes(1);
  });
});
