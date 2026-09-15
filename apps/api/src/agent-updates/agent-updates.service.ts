import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../security/secret-cipher.service';
import { apiPublicUrl } from '../common/public-url';
import {
  AgentHeartbeatDto,
  AgentUpdateReportDto,
  CreateAgentRolloutDto,
  EnrollAgentDto,
  UploadAgentReleaseDto,
} from './agent-updates.dto';
import {
  canReportUpdate,
  releaseManifest,
  terminalUpdateStates,
  validateAgentArtifact,
} from './agent-update.contract';

const hash = (input: string | Buffer) =>
  createHash('sha256').update(input).digest('hex');
const releaseFields = {
  id: true,
  version: true,
  architecture: true,
  sha256: true,
  size: true,
  manifest: true,
  signature: true,
  createdAt: true,
} as const;

@Injectable()
export class AgentUpdatesService {
  constructor(
    private readonly db: PrismaService,
    private readonly cipher: SecretCipherService,
  ) {}

  private async locked<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7419230)`;
        return work(tx);
      },
      { timeout: 30_000 },
    );
  }

  private async signingKey(tx: Prisma.TransactionClient) {
    let row = await tx.setting.findUnique({
      where: { key: 'agentUpdates.signingKey' },
    });
    if (!row) {
      if (!this.cipher.enabled)
        throw new BadRequestException(
          '请先配置 SETTINGS_ENCRYPTION_KEY，签名私钥必须加密保存。',
        );
      const pair = generateKeyPairSync('ed25519');
      const privateKey = pair.privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString();
      const publicKey = pair.publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString();
      row = await tx.setting.create({
        data: {
          key: 'agentUpdates.signingKey',
          value: this.cipher.encrypt(JSON.stringify({ privateKey, publicKey })),
        },
      });
    }
    return JSON.parse(this.cipher.decrypt(row.value)!) as {
      privateKey: string;
      publicKey: string;
    };
  }

  async overview() {
    const [releases, installations, rollouts, servers] = await Promise.all([
      this.db.agentRelease.findMany({
        select: releaseFields,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.db.agentInstallation.findMany({
        select: {
          id: true,
          serverId: true,
          serviceUnit: true,
          architecture: true,
          enabled: true,
          currentVersion: true,
          currentSha256: true,
          lastSeenAt: true,
          server: { select: { name: true, hostname: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.agentRollout.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          release: { select: releaseFields },
          jobs: { orderBy: { position: 'asc' } },
        },
      }),
      this.db.nodeServer.findMany({
        where: { retiredAt: null },
        select: { id: true, name: true, hostname: true },
      }),
    ]);
    return { releases, installations, rollouts, servers };
  }

  async upload(input: UploadAgentReleaseDto, binary: Buffer, actorId: string) {
    validateAgentArtifact(binary, input.architecture);
    return this.locked(async (tx) => {
      const existing = await tx.agentRelease.findUnique({
        where: { version_architecture: input },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException(
          '这个版本和架构已经上传，版本内容不可覆盖。',
        );
      const key = await this.signingKey(tx);
      const record = {
        id: randomUUID(),
        ...input,
        sha256: hash(binary),
        size: binary.length,
      };
      const manifest = releaseManifest(record);
      const signature = sign(
        null,
        Buffer.from(manifest),
        key.privateKey,
      ).toString('base64');
      const release = await tx.agentRelease.create({
        data: {
          ...record,
          manifest,
          signature,
          binary: new Uint8Array(binary),
          createdBy: actorId,
        },
        select: releaseFields,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'agent.release.upload',
          targetType: 'AgentRelease',
          targetId: record.id,
          metadata: {
            version: input.version,
            architecture: input.architecture,
            sha256: record.sha256,
          },
        },
      });
      return release;
    });
  }

  async enroll(input: EnrollAgentDto, actorId: string) {
    return this.locked(async (tx) => {
      const server = await tx.nodeServer.findFirst({
        where: { id: input.serverId, retiredAt: null },
      });
      if (!server) throw new NotFoundException('服务器不存在或已停用。');
      const existing = await tx.agentInstallation.findUnique({
        where: {
          serverId_serviceUnit: {
            serverId: input.serverId,
            serviceUnit: input.serviceUnit,
          },
        },
      });
      if (existing)
        throw new ConflictException('这个 Agent 已登记，请勿重复安装更新器。');
      const key = await this.signingKey(tx);
      const token = randomBytes(32).toString('base64url');
      const row = await tx.agentInstallation.create({
        data: { ...input, tokenHash: hash(token) },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'agent.installation.enroll',
          targetType: 'AgentInstallation',
          targetId: row.id,
        },
      });
      // The credential is returned only once and never included in overview/audit.
      return {
        id: row.id,
        token,
        apiBaseUrl: apiPublicUrl(),
        publicKey: key.publicKey,
        architecture: row.architecture,
        serviceUnit: row.serviceUnit,
      };
    });
  }

  async createRollout(input: CreateAgentRolloutDto, actorId: string) {
    const targetHash = hash(
      JSON.stringify([input.releaseId, input.installationIds]),
    );
    return this.locked(async (tx) => {
      const replay = await tx.agentRollout.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay) {
        if (replay.targetHash !== targetHash || replay.createdBy !== actorId)
          throw new ConflictException(
            '重复请求的版本或目标不同，请重新确认发布。',
          );
        return replay;
      }
      const release = await tx.agentRelease.findUnique({
        where: { id: input.releaseId },
        select: releaseFields,
      });
      if (!release) throw new NotFoundException('版本不存在。');
      const targets = await tx.agentInstallation.findMany({
        where: {
          id: { in: input.installationIds },
          enabled: true,
          server: { active: true, retiredAt: null },
        },
      });
      if (
        targets.length !== input.installationIds.length ||
        targets.some(
          (t) =>
            t.architecture !== release.architecture ||
            !t.lastSeenAt ||
            t.lastSeenAt.getTime() < Date.now() - 120_000,
        )
      )
        throw new BadRequestException('请选择同架构且最近两分钟在线的更新器。');
      if (
        await tx.agentUpdateJob.count({
          where: { activeKey: { in: input.installationIds } },
        })
      )
        throw new ConflictException('所选节点已有未完成的更新任务。');
      const rollout = await tx.agentRollout.create({
        data: {
          releaseId: input.releaseId,
          idempotencyKey: input.idempotencyKey,
          targetHash,
          createdBy: actorId,
          jobs: {
            create: input.installationIds.map((id, position) => ({
              installationId: id,
              position,
              activeKey: id,
            })),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'agent.rollout.create',
          targetType: 'AgentRollout',
          targetId: rollout.id,
          metadata: {
            installationIds: input.installationIds,
            releaseId: input.releaseId,
          },
        },
      });
      return rollout;
    });
  }

  async cancelRollout(id: string, actorId: string) {
    return this.locked(async (tx) => {
      const rollout = await tx.agentRollout.findUnique({ where: { id } });
      if (!rollout) throw new NotFoundException('发布批次不存在。');
      if (rollout.status === 'SUCCEEDED')
        throw new ConflictException('已完成的发布不能取消。');
      await tx.agentUpdateJob.updateMany({
        where: { rolloutId: id, status: 'QUEUED' },
        data: {
          status: 'CANCELED',
          activeKey: null,
          finishedAt: new Date(),
          message: '管理员停止后续发布',
        },
      });
      await tx.agentRollout.update({
        where: { id },
        data: { status: 'CANCELED' },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'agent.rollout.cancel',
          targetType: 'AgentRollout',
          targetId: id,
        },
      });
      return { ok: true };
    });
  }

  async authenticate(authorization?: string) {
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('更新器身份验证失败。');
    const token = authorization.slice(7);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('更新器身份验证失败。');
    const installation = await this.db.agentInstallation.findUnique({
      where: { tokenHash: hash(token) },
    });
    if (!installation?.enabled)
      throw new UnauthorizedException('更新器身份验证失败。');
    return installation;
  }

  async poll(installationId: string, heartbeat: AgentHeartbeatDto) {
    return this.locked(async (tx) => {
      const installation = await tx.agentInstallation.findUniqueOrThrow({
        where: { id: installationId },
      });
      if (installation.architecture !== heartbeat.architecture)
        throw new ConflictException('更新器架构与登记信息不一致。');
      await tx.agentInstallation.update({
        where: { id: installationId },
        data: {
          lastSeenAt: new Date(),
          currentVersion: heartbeat.currentVersion,
          currentSha256: heartbeat.currentSha256,
        },
      });
      const job = await tx.agentUpdateJob.findUnique({
        where: { activeKey: installationId },
        include: {
          rollout: { include: { release: { select: releaseFields } } },
        },
      });
      if (!job) return { job: null };
      if (job.status === 'QUEUED') {
        if (job.rollout.status !== 'RUNNING') return { job: null };
        // One in-flight update fleet-wide; an offline updater holds its slot.
        // We never reassign an uncertain installation to another job.
        if (
          await tx.agentUpdateJob.count({
            where: {
              status: {
                in: [
                  'DOWNLOADING',
                  'VERIFYING',
                  'INSTALLING',
                  'CHECKING',
                  'ROLLING_BACK',
                ],
              },
            },
          })
        )
          return { job: null };
        if (
          await tx.agentUpdateJob.count({
            where: {
              rolloutId: job.rolloutId,
              position: { lt: job.position },
              status: { not: 'SUCCEEDED' },
            },
          })
        )
          return { job: null };
        await tx.agentUpdateJob.update({
          where: { id: job.id },
          data: { status: 'DOWNLOADING', startedAt: new Date() },
        });
      }
      return {
        job: {
          id: job.id,
          manifest: job.rollout.release.manifest,
          signature: job.rollout.release.signature,
          downloadPath: `/api/agent-updater/jobs/${job.id}/artifact`,
        },
      };
    });
  }

  async artifact(installationId: string, jobId: string) {
    const job = await this.db.agentUpdateJob.findFirst({
      where: {
        id: jobId,
        installationId,
        activeKey: installationId,
        status: { not: 'QUEUED' },
      },
      include: { rollout: { include: { release: true } } },
    });
    if (!job) throw new NotFoundException('更新包不可访问。');
    return job.rollout.release;
  }

  async report(
    installationId: string,
    jobId: string,
    input: AgentUpdateReportDto,
  ) {
    return this.locked(async (tx) => {
      const job = await tx.agentUpdateJob.findFirst({
        where: { id: jobId, installationId },
        include: {
          rollout: { include: { release: { select: releaseFields } } },
        },
      });
      if (!job) throw new NotFoundException('更新任务不存在。');
      if (job.status === 'QUEUED' || !canReportUpdate(job.status, input.status))
        throw new ConflictException('更新状态顺序不正确。');
      if (
        input.status === 'SUCCEEDED' &&
        (input.currentVersion !== job.rollout.release.version ||
          input.currentSha256 !== job.rollout.release.sha256)
      )
        throw new ConflictException('运行版本与发布版本不一致。');
      if (terminalUpdateStates.includes(job.status)) return { ok: true };
      const terminal = terminalUpdateStates.includes(input.status);
      await tx.agentUpdateJob.update({
        where: { id: jobId },
        data: {
          status: input.status,
          message: input.message,
          ...(terminal ? { activeKey: null, finishedAt: new Date() } : {}),
        },
      });
      await tx.agentInstallation.update({
        where: { id: installationId },
        data: {
          currentVersion: input.currentVersion,
          currentSha256: input.currentSha256,
          lastSeenAt: new Date(),
        },
      });
      if (['FAILED', 'ROLLED_BACK'].includes(input.status)) {
        await tx.agentRollout.update({
          where: { id: job.rolloutId },
          data: { status: 'PAUSED' },
        });
        await tx.agentUpdateJob.updateMany({
          where: { rolloutId: job.rolloutId, status: 'QUEUED' },
          data: {
            status: 'CANCELED',
            activeKey: null,
            finishedAt: new Date(),
            message: '前一台更新失败，后续节点未执行；修复后可重新选择发布。',
          },
        });
      } else if (
        input.status === 'SUCCEEDED' &&
        !(await tx.agentUpdateJob.count({
          where: { rolloutId: job.rolloutId, status: { not: 'SUCCEEDED' } },
        }))
      ) {
        await tx.agentRollout.update({
          where: { id: job.rolloutId },
          data: { status: 'SUCCEEDED' },
        });
      }
      if (terminal)
        await tx.auditLog.create({
          data: {
            action: 'agent.update.result',
            targetType: 'AgentUpdateJob',
            targetId: job.id,
            metadata: {
              installationId,
              status: input.status,
              message: input.message,
            },
          },
        });
      return { ok: true };
    });
  }
}
