import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HysteriaAuthObservation {
  userId?: string;
  accessTokenId?: string;
  nodeId?: string;
  granted: boolean;
  reason: string;
  remoteAddr?: string;
  requestedTxBps?: number;
  submittedTokenPreview?: string;
}

@Injectable()
export class HysteriaAuthTelemetryService implements OnModuleDestroy {
  private readonly logger = new Logger(HysteriaAuthTelemetryService.name);
  private readonly inFlight = new Set<Promise<void>>();
  private accepting = true;
  private lastWarningAt = -Infinity;
  private droppedSinceWarning = 0;

  constructor(private readonly prisma: PrismaService) {}

  // Observations are best effort. Never queue an unbounded amount of optional
  // work or let it hold up an already computed permission decision.
  record(observation: HysteriaAuthObservation): void {
    if (!this.accepting || this.inFlight.size >= 2) {
      this.warnDropped();
      return;
    }
    const write = this.persist({ ...observation })
      .catch(() => this.warnDropped())
      .finally(() => this.inFlight.delete(write));
    this.inFlight.add(write);
  }

  async onModuleDestroy() {
    this.accepting = false;
    await Promise.allSettled(this.inFlight);
  }

  private async persist(observation: HysteriaAuthObservation) {
    await this.prisma.$transaction(
      async (tx) => {
        // These are database deadlines, not a Promise.race that leaves a blocked
        // query running and occupying the shared connection pool afterward.
        await tx.$executeRaw`SET LOCAL statement_timeout = '250ms'`;
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        if (observation.granted && observation.accessTokenId) {
          await tx.accessToken.update({
            where: { id: observation.accessTokenId },
            data: { lastUsedAt: new Date() },
          });
        }
        await tx.authEvent.create({ data: observation });
      },
      { maxWait: 50, timeout: 1_000 },
    );
  }

  private warnDropped() {
    this.droppedSinceWarning += 1;
    const now = Date.now();
    if (now - this.lastWarningAt < 60_000) return;
    this.logger.warn(
      `Skipped ${this.droppedSinceWarning} optional authentication observation(s); permission decisions are unchanged`,
    );
    this.droppedSinceWarning = 0;
    this.lastWarningAt = now;
  }
}
