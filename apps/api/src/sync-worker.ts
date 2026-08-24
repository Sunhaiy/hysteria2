import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SyncWorkerModule } from './sync-worker.module';
import { UsageSyncService } from './usage-sync/usage-sync.service';

const logger = new Logger('UsageSyncWorker');
const minimumIntervalMs = 10_000;

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SyncWorkerModule);
  const sync = app.get(UsageSyncService);
  const configuredInterval = Number(
    process.env.NODE_SYNC_INTERVAL_MS ?? 60_000,
  );
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.max(configuredInterval, minimumIntervalMs)
    : 60_000;
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;

  const run = async () => {
    if (
      process.env.NODE_SYNC_ENABLED !== 'true' &&
      process.env.HYSTERIA_SYNC_ENABLED !== 'true'
    ) {
      logger.warn('Node synchronization is disabled');
      return;
    }

    const startedAt = Date.now();
    try {
      const results = await sync.syncAllNodes();
      const failures = results.filter(
        (result) => 'error' in result && Boolean(result.error),
      ).length;
      logger.log(
        `Synchronized ${results.length} nodes with ${failures} failures in ${Date.now() - startedAt}ms`,
      );
    } catch (error) {
      logger.error(
        `Node synchronization failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    }
  };

  const schedule = () => {
    timer = setTimeout(() => {
      void run().then(() => {
        if (!stopping) schedule();
      });
    }, intervalMs);
  };

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    logger.log(`Stopping after ${signal}`);
    await app.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await run();
  schedule();
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    `Worker startup failed: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
