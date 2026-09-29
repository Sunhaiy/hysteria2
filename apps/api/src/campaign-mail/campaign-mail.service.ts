import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignDeliveryError, MailService } from '../mail/mail.service';
import { expiredMemberWhere } from '../entitlement/expired-member';
import { apiPublicUrl, webPublicUrl } from '../common/public-url';

export function campaignInput(raw: unknown) {
  const v = raw as Record<string, unknown>;
  if (
    !v ||
    typeof v.subject !== 'string' ||
    !v.subject.trim() ||
    v.subject.length > 120 ||
    /[\r\n]/.test(v.subject) ||
    typeof v.body !== 'string' ||
    !v.body.trim() ||
    v.body.length > 12000 ||
    !['all', 'expired', 'selected'].includes(String(v.audience))
  )
    throw new BadRequestException('请填写标题、正文及有效的收件范围');
  const emails =
    typeof v.emails === 'string'
      ? [
          ...new Set(
            v.emails
              .split(/[\s,，;；]+/)
              .filter(Boolean)
              .map((e) => e.toLowerCase()),
          ),
        ].sort()
      : [];
  if (
    v.audience === 'selected' &&
    (!emails.length ||
      emails.length > 500 ||
      emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
  )
    throw new BadRequestException('请填写1–500个有效的已注册用户邮箱');
  return {
    subject: v.subject.trim(),
    body: v.body.trim(),
    audience: String(v.audience),
    emails: v.audience === 'selected' ? emails : [],
  };
}

@Injectable()
export class CampaignMailService {
  constructor(
    private readonly db: PrismaService,
    private readonly mail: MailService,
  ) {}
  private signature(userId: string) {
    const key = process.env.JWT_SECRET;
    if (!key) throw new BadRequestException('邮件退订签名未配置');
    return createHmac('sha256', key)
      .update(`campaign-unsubscribe:${userId}`)
      .digest('hex');
  }
  unsubscribeUrl(userId: string) {
    return `${apiPublicUrl()}/api/campaign-mail/unsubscribe/${encodeURIComponent(userId)}/${this.signature(userId)}`;
  }
  verifyUnsubscribe(userId: string, signature: string) {
    const expected = this.signature(userId);
    if (
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    )
      throw new BadRequestException('退订链接无效');
  }
  async unsubscribe(userId: string, signature: string) {
    this.verifyUnsubscribe(userId, signature);
    if (
      await this.db.user.findUnique({
        where: { id: userId },
        select: { id: true },
      })
    )
      await this.db.campaignMailOptOut.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
  }
  async preview(raw: unknown, actorId: string, key: string) {
    const input = campaignInput(raw);
    if (!/^[\w-]{8,100}$/.test(key))
      throw new BadRequestException('请求标识无效，请刷新后重试');
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const existing = await this.db.campaignMailJob.findUnique({
      where: { actorId_idempotencyKey: { actorId, idempotencyKey: key } },
    });
    if (existing) {
      if (existing.inputHash !== hash)
        throw new ConflictException('预览内容已变化，请重新预览');
      return this.detail(existing.id);
    }
    const where: Prisma.UserWhereInput = {
      AND: [
        {
          role: 'MEMBER',
          status: 'ACTIVE',
          deletedAt: null,
          campaignMailOptOut: { is: null },
        },
        input.audience === 'expired' ? expiredMemberWhere() : {},
        input.audience === 'selected'
          ? { email: { in: input.emails, mode: 'insensitive' } }
          : {},
      ],
    };
    const recipients = await this.db.user.findMany({
      where,
      select: { id: true, email: true },
      orderBy: { id: 'asc' },
      take: 5001,
    });
    if (!recipients.length)
      throw new BadRequestException(
        '没有符合条件的收件人（已退订、停用或删除的用户不发送）',
      );
    if (recipients.length > 5000)
      throw new BadRequestException('单次最多5000人，请分批选择邮箱');
    let jobId: string;
    try {
      jobId = await this.db.$transaction(async (tx) => {
        const job = await tx.campaignMailJob.create({
          data: {
            actorId,
            idempotencyKey: key,
            inputHash: hash,
            audience: input.audience,
            subject: input.subject,
            body: input.body,
          },
        });
        await tx.campaignMailDelivery.createMany({
          data: recipients.map((u) => ({
            jobId: job.id,
            userId: u.id,
            email: u.email,
          })),
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'CAMPAIGN_MAIL_PREVIEW',
            targetType: 'CampaignMailJob',
            targetId: job.id,
            metadata: { count: recipients.length, audience: input.audience },
          },
        });
        return job.id;
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      const replay = await this.db.campaignMailJob.findUniqueOrThrow({
        where: { actorId_idempotencyKey: { actorId, idempotencyKey: key } },
      });
      if (replay.inputHash !== hash)
        throw new ConflictException('预览内容已变化，请重新预览');
      jobId = replay.id;
    }
    return this.detail(jobId);
  }
  async detail(id: string) {
    const job = await this.db.campaignMailJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('邮件任务不存在');
    const [counts, recipients, issues] = await Promise.all([
      this.db.campaignMailDelivery.groupBy({
        by: ['status'],
        where: { jobId: id },
        _count: true,
      }),
      this.db.campaignMailDelivery.findMany({
        where: { jobId: id },
        select: { email: true },
        orderBy: { id: 'asc' },
        take: 20,
      }),
      this.db.campaignMailDelivery.findMany({
        where: { jobId: id, status: { in: ['FAILED', 'UNKNOWN', 'SKIPPED'] } },
        select: { email: true, status: true, error: true },
        take: 30,
      }),
    ]);
    return {
      id: job.id,
      subject: job.subject,
      body: job.body,
      audience: job.audience,
      status: job.status,
      createdAt: job.createdAt,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      recipients,
      issues,
      activityUrl: `${webPublicUrl()}/portal/holiday`,
    };
  }
  async list() {
    const jobs = await this.db.campaignMailJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true },
    });
    return Promise.all(jobs.map((j) => this.detail(j.id)));
  }
  async queue(id: string, actorId: string, confirmed: unknown) {
    if (confirmed !== true) throw new BadRequestException('请先核对并确认发送');
    if (!(await this.mail.isConfigured()))
      throw new BadRequestException('请先配置邮件服务');
    this.signature(actorId);
    await this.db.$transaction(async (tx) => {
      const job = await tx.campaignMailJob.findUnique({ where: { id } });
      if (!job || job.actorId !== actorId)
        throw new NotFoundException('请由预览任务的管理员确认发送');
      if (!['DRAFT', 'PAUSED'].includes(job.status)) return;
      if (
        job.status === 'DRAFT' &&
        Date.now() - job.createdAt.getTime() > 3600000
      )
        throw new ConflictException('预览已超过一小时，请重新预览收件范围');
      const updated = await tx.campaignMailJob.updateMany({
        where: { id, status: job.status },
        data: { status: 'QUEUED' },
      });
      if (updated.count)
        await tx.auditLog.create({
          data: {
            actorId,
            action:
              job.status === 'PAUSED'
                ? 'CAMPAIGN_MAIL_RESUMED'
                : 'CAMPAIGN_MAIL_QUEUED',
            targetType: 'CampaignMailJob',
            targetId: id,
          },
        });
    });
    return this.detail(id);
  }
  async cancel(id: string, actorId: string) {
    await this.db.$transaction(async (tx) => {
      const result = await tx.campaignMailJob.updateMany({
        where: { id, status: { in: ['DRAFT', 'QUEUED', 'PAUSED'] } },
        data: { status: 'CANCELED' },
      });
      if (result.count) {
        await tx.campaignMailDelivery.updateMany({
          where: { jobId: id, status: 'PENDING' },
          data: { status: 'SKIPPED', error: '管理员取消待发邮件' },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'CAMPAIGN_MAIL_CANCELED',
            targetType: 'CampaignMailJob',
            targetId: id,
          },
        });
      }
    });
    return this.detail(id);
  }
  async processPending() {
    // An interrupted SMTP transaction is ambiguous: never resend automatically.
    await this.db.campaignMailDelivery.updateMany({
      where: {
        status: 'SENDING',
        startedAt: { lt: new Date(Date.now() - 10 * 60000) },
      },
      data: {
        status: 'UNKNOWN',
        error: '发送过程被中断，结果待核实；未自动重发',
      },
    });
    if (!(await this.mail.isConfigured())) {
      await this.db.$transaction(async (tx) => {
        const jobs = await tx.campaignMailJob.findMany({
          where: { status: 'QUEUED' },
          select: { id: true },
        });
        for (const job of jobs) {
          const changed = await tx.campaignMailJob.updateMany({
            where: { id: job.id, status: 'QUEUED' },
            data: { status: 'PAUSED' },
          });
          if (changed.count)
            await tx.auditLog.create({
              data: {
                action: 'CAMPAIGN_MAIL_AUTO_PAUSED',
                targetType: 'CampaignMailJob',
                targetId: job.id,
                metadata: { reason: 'SMTP_NOT_CONFIGURED' },
              },
            });
        }
      });
      return;
    }
    const pending = await this.db.campaignMailDelivery.findMany({
      where: { status: 'PENDING', job: { status: 'QUEUED' } },
      orderBy: { id: 'asc' },
      take: 5,
      include: { job: true },
    });
    for (const delivery of pending) {
      const claim = await this.db.campaignMailDelivery.updateMany({
        where: {
          id: delivery.id,
          status: 'PENDING',
          job: { status: 'QUEUED' },
        },
        data: { status: 'SENDING', startedAt: new Date() },
      });
      if (!claim.count) continue;
      const user = await this.db.user.findFirst({
        where: {
          id: delivery.userId,
          email: delivery.email,
          role: 'MEMBER',
          status: 'ACTIVE',
          deletedAt: null,
          campaignMailOptOut: { is: null },
        },
        select: { id: true },
      });
      if (!user) {
        await this.db.campaignMailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SKIPPED',
            error: '用户已退订、停用、删除或邮箱已变化',
          },
        });
        continue;
      }
      try {
        await this.mail.sendCampaign({
          to: delivery.email,
          subject: delivery.job.subject,
          body: delivery.job.body,
          activityUrl: `${webPublicUrl()}/portal/holiday`,
          unsubscribeUrl: this.unsubscribeUrl(user.id),
          messageId: `<campaign-${delivery.id}@${new URL(webPublicUrl()).hostname}>`,
        });
      } catch (error) {
        const definite =
          error instanceof CampaignDeliveryError
            ? error.definitive
            : error instanceof BadRequestException;
        const pause =
          error instanceof CampaignDeliveryError
            ? error.pauseQueue
            : !(error instanceof BadRequestException);
        await this.db.$transaction(async (tx) => {
          await tx.campaignMailDelivery.update({
            where: { id: delivery.id },
            data: {
              status: definite ? 'FAILED' : 'UNKNOWN',
              error:
                error instanceof Error
                  ? error.message.slice(0, 200)
                  : '发送结果待核实，已暂停',
            },
          });
          if (pause) {
            const changed = await tx.campaignMailJob.updateMany({
              where: { id: delivery.jobId, status: 'QUEUED' },
              data: { status: 'PAUSED' },
            });
            if (changed.count)
              await tx.auditLog.create({
                data: {
                  action: 'CAMPAIGN_MAIL_AUTO_PAUSED',
                  targetType: 'CampaignMailJob',
                  targetId: delivery.jobId,
                  metadata: { deliveryId: delivery.id, definitive: definite },
                },
              });
          }
        });
        if (pause) break;
        continue;
      }
      // Keep DB-write failure outside the SMTP catch; stale recovery marks it unknown.
      await this.db.campaignMailDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
    }
    await this.db.campaignMailJob.updateMany({
      where: {
        status: 'QUEUED',
        deliveries: { none: { status: { in: ['PENDING', 'SENDING'] } } },
      },
      data: { status: 'COMPLETED' },
    });
  }
}
