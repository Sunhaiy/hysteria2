import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OperationsService } from './operations/operations.service';
import { SyncWorkerModule } from './sync-worker.module';
import { UsageSyncService } from './usage-sync/usage-sync.service';
import { NodeRuntimeCommandService } from './node-ops/node-runtime-command.service';
import { NodeTrafficGuardService } from './node-ops/node-traffic-guard.service';

const logger = new Logger('UsageSyncWorker');
const minimumIntervalMs = 10_000;
const minimumPollIntervalMs = 1_000;

function intervalFromEnv(name: string, fallback: number, minimum: number) {
  const configured = Number(process.env[name] ?? fallback);
  return Number.isFinite(configured) ? Math.max(configured, minimum) : fallback;
}

function retentionDaysFromEnv(name: string, fallback: number) {
  const legacy = process.env.DATA_RETENTION_DAYS;
  const configured = Number.parseInt(process.env[name] ?? legacy ?? '', 10);
  return Number.isFinite(configured) ? Math.max(configured, 1) : fallback;
}

class RecurringTask {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
    private readonly operation: () => Promise<void>,
    private readonly runImmediately = true,
  ) {}

  start() {
    if (this.runImmediately) void this.tick();
    else this.schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }

  private async tick() {
    if (this.stopped) return;
    if (this.inFlight) {
      logger.warn(`${this.name} is still running; skipped this interval`);
      this.schedule();
      return;
    }

    const operation = Promise.resolve().then(this.operation);
    this.inFlight = operation;
    void operation
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = undefined;
      })
      .catch(() => undefined);

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error(`${this.name} exceeded ${this.timeoutMs}ms`)),
            this.timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      logger.error(
        `${this.name} failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      this.schedule();
    }
  }
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SyncWorkerModule);
  const sync = app.get(UsageSyncService);
  const operations = app.get(OperationsService);
  const runtime = app.get(NodeRuntimeCommandService);
  const trafficGuard = app.get(NodeTrafficGuardService);
  const syncIntervalMs = intervalFromEnv(
    'NODE_SYNC_INTERVAL_MS',
    60_000,
    minimumIntervalMs,
  );
  const presenceIntervalMs = intervalFromEnv(
    'NODE_PRESENCE_INTERVAL_MS',
    15_000,
    minimumIntervalMs,
  );
  const healthIntervalMs = intervalFromEnv(
    'NODE_HEALTH_INTERVAL_MS',
    60_000,
    minimumIntervalMs,
  );
  const requestPollIntervalMs = intervalFromEnv(
    'NODE_CHECK_REQUEST_POLL_MS',
    2_000,
    minimumPollIntervalMs,
  );
  const cleanupIntervalMs = intervalFromEnv(
    'DATA_CLEANUP_INTERVAL_MS',
    24 * 60 * 60 * 1000,
    60_000,
  );
  const runtimeCommandPollIntervalMs = intervalFromEnv(
    'NODE_RUNTIME_COMMAND_POLL_MS',
    2_000,
    minimumPollIntervalMs,
  );
  const runtimeStatusIntervalMs = intervalFromEnv(
    'NODE_RUNTIME_STATUS_INTERVAL_MS',
    30_000,
    minimumIntervalMs,
  );
  const trafficGuardIntervalMs = intervalFromEnv(
    'NODE_TRAFFIC_GUARD_INTERVAL_MS',
    60_000,
    minimumIntervalMs,
  );
  let stopping = false;
  const tasks: RecurringTask[] = [];
  const syncEnabled =
    process.env.NODE_SYNC_ENABLED === 'true' ||
    process.env.HYSTERIA_SYNC_ENABLED === 'true';
  const operationsEnabled = process.env.NODE_OPERATIONS_ENABLED !== 'false';
  const runtimeControlEnabled =
    process.env.NODE_RUNTIME_CONTROL_ENABLED !== 'false';

  if (syncEnabled) {
    tasks.push(
      new RecurringTask(
        'Node synchronization',
        syncIntervalMs,
        55_000,
        async () => {
          const startedAt = Date.now();
          const results = await sync.syncAllNodes();
          const failures = results.filter(
            (result) => 'error' in result && Boolean(result.error),
          ).length;
          logger.log(
            `Synchronized ${results.length} nodes with ${failures} failures in ${Date.now() - startedAt}ms`,
          );
        },
      ),
    );
    tasks.push(
      new RecurringTask(
        'Control-plane data cleanup',
        cleanupIntervalMs,
        5 * 60_000,
        async () => {
          const policy = {
            destinationDays: retentionDaysFromEnv(
              'DESTINATION_RETENTION_DAYS',
              7,
            ),
            onlineDays: retentionDaysFromEnv('ONLINE_RETENTION_DAYS', 7),
            authEventDays: retentionDaysFromEnv(
              'AUTH_EVENT_RETENTION_DAYS',
              30,
            ),
          };
          const result = await sync.cleanup(policy);
          logger.log(
            `Cleanup removed ${result.deletedDestinationBatches} destination batches, ${result.deletedSnapshots} online snapshots, and ${result.deletedAuthEvents} auth events`,
          );
        },
        false,
      ),
    );
  } else {
    logger.warn('Node synchronization is disabled');
  }

  if (operationsEnabled) {
    tasks.push(
      new RecurringTask(
        'Online presence collection',
        presenceIntervalMs,
        12_000,
        async () => {
          const results = await operations.collectPresence();
          const failures = results.filter((result) => 'error' in result).length;
          logger.log(
            `Collected online presence from ${results.length} nodes with ${failures} failures`,
          );
        },
      ),
      new RecurringTask(
        'Node health and alerts',
        healthIntervalMs,
        30_000,
        async () => {
          const results = await operations.probeHealth();
          const failures = results.filter((result) => !result.healthy).length;
          logger.log(
            `Probed ${results.length} nodes with ${failures} failures`,
          );
        },
      ),
      new RecurringTask(
        'Manual check request polling',
        requestPollIntervalMs,
        45_000,
        async () => {
          if (await operations.consumeRequestedCheck()) {
            logger.log('Completed requested operations check');
          }
        },
      ),
    );
  } else {
    logger.warn('Online presence and health collection are disabled');
  }

  if (runtimeControlEnabled) {
    const recovered = await runtime.recoverAbandonedCommands();
    if (recovered.count > 0) {
      logger.warn(`Recovered ${recovered.count} interrupted runtime commands`);
    }
    tasks.push(
      new RecurringTask(
        'Node traffic limit enforcement',
        trafficGuardIntervalMs,
        20_000,
        async () => {
          const result = await trafficGuard.enforce();
          if (result.queued > 0) {
            logger.warn(
              `Queued ${result.queued} automatic endpoint stop command(s) after server traffic limits were reached`,
            );
          }
        },
      ),
      new RecurringTask(
        'Node runtime command execution',
        runtimeCommandPollIntervalMs,
        20_000,
        async () => {
          const results = await runtime.processPending(1);
          for (const result of results) {
            logger.log(
              `Runtime command ${result.id} completed with ${result.status}`,
            );
          }
        },
      ),
      new RecurringTask(
        'Node runtime status refresh',
        runtimeStatusIntervalMs,
        20_000,
        async () => {
          const results = await runtime.refreshRuntimeStatuses();
          const failures = results.filter((result) => 'error' in result).length;
          logger.log(
            `Refreshed runtime status for ${results.length} nodes with ${failures} failures`,
          );
        },
      ),
    );
  } else {
    logger.warn('Node runtime control is disabled');
  }

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    for (const task of tasks) task.stop();
    logger.log(`Stopping after ${signal}`);
    await app.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  for (const task of tasks) task.start();
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    `Worker startup failed: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
