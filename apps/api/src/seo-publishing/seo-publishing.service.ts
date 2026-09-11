import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SeoArticleStatus,
  SeoGenerationStatus,
  SeoImageSource,
  SeoIndexEngine,
  SeoIndexOperation,
  SeoIndexStatus,
  SeoKeywordStatus,
  SeoRevisionSource,
  type SeoArticle,
  type SeoArticleRevision,
  type SeoKeyword,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { CacheService } from '../cache/cache.service';
import { pageResponse, parsePage } from '../common/pagination';
import { apiPublicUrl, webPublicUrl } from '../common/public-url';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  SeoAiAdapter,
  type GeneratedArticleDraft,
  type SeoPublicSource,
} from './seo-ai.adapter';
import {
  applyEditorialAudit,
  buildGeneratedDocument,
  evaluateSeoDraft,
  extractTiptapHeadings,
  renderTiptapHtml,
  slugifyArticleTitle,
  tiptapPlainText,
  type SeoQualityReport,
  type TiptapNode,
} from './seo-content';
import { seoGenerationPipelineVersion } from './seo-generation-pipeline';
import type {
  CreateSeoKeywordDto,
  SaveSeoArticleDto,
  SeoListQueryDto,
  UpdateSeoKeywordDto,
  UpdateSeoSettingsDto,
} from './seo-publishing.dto';
import { SeoSearchAdapter } from './seo-search.adapter';

const publicArticlesCacheKey = 'seo:published:v1';
const promptVersion = seoGenerationPipelineVersion;
const seoImageMaxBytes = 20 * 1024 * 1024;

type AdminArticleRecord = SeoArticle & {
  draftRevision: SeoArticleRevision | null;
  publishedRevision: SeoArticleRevision | null;
  revisions?: SeoArticleRevision[];
  keyword?: SeoKeyword | null;
};

type PublicArticleRecord = SeoArticle & {
  publishedRevision: SeoArticleRevision | null;
};

export function seoImageDirectory() {
  return resolve(
    process.env.SEO_IMAGE_DIR ?? join(process.cwd(), 'storage', 'seo-images'),
  );
}

@Injectable()
export class SeoPublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
    private readonly ai: SeoAiAdapter,
    private readonly search: SeoSearchAdapter,
  ) {}

  async getAdminSettings() {
    const [
      enabled,
      aiBaseUrl,
      textModel,
      imageModel,
      timeoutMs,
      scheduleDays,
      scheduleHour,
      indexNowEnabled,
      indexNowKey,
      googleEnabled,
      googleProperty,
      aiApiKey,
      googleCredential,
    ] = await Promise.all([
      this.settings.get('seo.enabled'),
      this.settings.get('seo.aiBaseUrl'),
      this.settings.get('seo.textModel'),
      this.settings.get('seo.imageModel'),
      this.settings.get('seo.timeoutMs'),
      this.settings.get('seo.scheduleDays'),
      this.settings.get('seo.scheduleHour'),
      this.settings.get('seo.indexNowEnabled'),
      this.settings.get('seo.indexNowKey'),
      this.settings.get('seo.googleEnabled'),
      this.settings.get('seo.googleProperty'),
      this.settings.getSecret('seo.aiApiKey'),
      this.settings.getSecret('seo.googleServiceAccountJson'),
    ]);
    return {
      enabled: enabled === 'true',
      aiBaseUrl: aiBaseUrl ?? '',
      textModel: textModel ?? '',
      imageModel: imageModel ?? '',
      timeoutMs: Number(timeoutMs ?? 60_000),
      scheduleDays: this.parseScheduleDays(scheduleDays),
      scheduleHour: Number(scheduleHour ?? 10),
      aiConfigured: Boolean(aiBaseUrl && textModel && aiApiKey),
      indexNowEnabled: indexNowEnabled === 'true',
      indexNowKey: indexNowKey ?? '',
      googleEnabled: googleEnabled === 'true',
      googleProperty: googleProperty ?? '',
      googleConfigured: Boolean(googleProperty && googleCredential),
      timezone: 'Asia/Shanghai',
    };
  }

  async updateAdminSettings(input: UpdateSeoSettingsDto) {
    const updates: Record<string, string> = {};
    if (input.enabled !== undefined)
      updates['seo.enabled'] = String(input.enabled);
    if (input.aiBaseUrl !== undefined) {
      const url = new URL(input.aiBaseUrl.trim());
      if (
        process.env.NODE_ENV === 'production' &&
        url.protocol !== 'https:' &&
        !['localhost', '127.0.0.1'].includes(url.hostname)
      ) {
        throw new BadRequestException('生产环境 AI Base URL 必须使用 HTTPS');
      }
      updates['seo.aiBaseUrl'] = url.toString().replace(/\/$/, '');
    }
    if (input.textModel !== undefined)
      updates['seo.textModel'] = input.textModel.trim();
    if (input.imageModel !== undefined)
      updates['seo.imageModel'] = input.imageModel.trim();
    if (input.aiApiKey?.trim()) updates['seo.aiApiKey'] = input.aiApiKey.trim();
    if (input.clearAiApiKey) updates['seo.aiApiKey'] = '';
    if (input.timeoutMs !== undefined)
      updates['seo.timeoutMs'] = String(input.timeoutMs);
    if (input.scheduleDays !== undefined) {
      const days = [...new Set(input.scheduleDays)].sort();
      if (!days.length || days.some((day) => day < 0 || day > 6)) {
        throw new BadRequestException('生成日期必须位于星期日到星期六之间');
      }
      updates['seo.scheduleDays'] = days.join(',');
    }
    if (input.scheduleHour !== undefined)
      updates['seo.scheduleHour'] = String(input.scheduleHour);
    if (input.indexNowEnabled !== undefined) {
      updates['seo.indexNowEnabled'] = String(input.indexNowEnabled);
      if (
        input.indexNowEnabled &&
        !(await this.settings.get('seo.indexNowKey'))
      ) {
        updates['seo.indexNowKey'] = randomBytes(16).toString('hex');
      }
    }
    if (input.googleEnabled !== undefined)
      updates['seo.googleEnabled'] = String(input.googleEnabled);
    if (input.googleProperty !== undefined) {
      updates['seo.googleProperty'] = input.googleProperty.trim();
    }
    if (input.googleServiceAccountJson?.trim()) {
      try {
        const value = JSON.parse(input.googleServiceAccountJson) as Record<
          string,
          unknown
        >;
        if (!value.client_email || !value.private_key)
          throw new Error('missing fields');
      } catch {
        throw new BadRequestException('Google 服务账号 JSON 无效');
      }
      updates['seo.googleServiceAccountJson'] =
        input.googleServiceAccountJson.trim();
    }
    if (input.clearGoogleServiceAccount)
      updates['seo.googleServiceAccountJson'] = '';
    await this.settings.setMany(updates);
    return this.getAdminSettings();
  }

  testAiConnection() {
    return this.ai.testConnection();
  }

  testGoogleConnection() {
    return this.search.testGoogle();
  }

  async listKeywords(query: SeoListQueryDto) {
    const { page, pageSize, skip } = parsePage(query);
    const q = query.q?.trim();
    const where: Prisma.SeoKeywordWhereInput = q
      ? { keyword: { contains: q, mode: 'insensitive' } }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.seoKeyword.findMany({
        where,
        include: { article: { select: { slug: true, status: true } } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.seoKeyword.count({ where }),
    ]);
    return pageResponse(items, total, page, pageSize);
  }

  async createKeyword(input: CreateSeoKeywordDto) {
    const keyword = input.keyword.trim();
    if (!keyword) throw new BadRequestException('关键词不能为空');
    try {
      return await this.prisma.seoKeyword.create({
        data: {
          keyword,
          category: input.category.trim() || '教程',
          searchIntent: input.searchIntent?.trim() || null,
          priority: input.priority ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该关键词已经存在');
      }
      throw error;
    }
  }

  async updateKeyword(id: string, input: UpdateSeoKeywordDto) {
    await this.requireKeyword(id);
    return this.prisma.seoKeyword.update({
      where: { id },
      data: {
        keyword: input.keyword?.trim(),
        category: input.category?.trim(),
        searchIntent: input.searchIntent?.trim(),
        priority: input.priority,
        status: input.status,
      },
    });
  }

  async listAdminArticles(query: SeoListQueryDto) {
    const { page, pageSize, skip } = parsePage(query);
    const q = query.q?.trim();
    const where: Prisma.SeoArticleWhereInput = q
      ? {
          OR: [
            { slug: { contains: q, mode: 'insensitive' } },
            { draftRevision: { title: { contains: q, mode: 'insensitive' } } },
            {
              publishedRevision: {
                title: { contains: q, mode: 'insensitive' },
              },
            },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.seoArticle.findMany({
        where,
        include: {
          draftRevision: { include: { coverImage: true } },
          publishedRevision: { include: { coverImage: true } },
          keyword: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.seoArticle.count({ where }),
    ]);
    return pageResponse(
      items.map((item) => this.serializeAdminArticle(item)),
      total,
      page,
      pageSize,
    );
  }

  async getAdminArticle(id: string) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { id },
      include: {
        draftRevision: { include: { coverImage: true } },
        publishedRevision: { include: { coverImage: true } },
        revisions: {
          include: { coverImage: true },
          orderBy: { version: 'desc' },
        },
        keyword: true,
      },
    });
    if (!article) throw new NotFoundException('文章不存在');
    return this.serializeAdminArticle(article);
  }

  async createArticle(input: SaveSeoArticleDto, actorId: string) {
    const slug = await this.availableSlug(input.slug || input.title);
    const prepared = await this.prepareRevision(input, null);
    const result = await this.prisma.$transaction(async (tx) => {
      const article = await tx.seoArticle.create({
        data: { slug, category: input.category.trim(), createdById: actorId },
      });
      const revision = await tx.seoArticleRevision.create({
        data: {
          articleId: article.id,
          version: 1,
          source: SeoRevisionSource.MANUAL,
          slug,
          ...prepared,
          createdById: actorId,
        },
      });
      return tx.seoArticle.update({
        where: { id: article.id },
        data: { draftRevisionId: revision.id },
        include: {
          draftRevision: { include: { coverImage: true } },
          publishedRevision: true,
        },
      });
    });
    return this.serializeAdminArticle(result);
  }

  async saveArticle(id: string, input: SaveSeoArticleDto, actorId: string) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { id },
      include: { draftRevision: true, publishedRevision: true },
    });
    if (!article) throw new NotFoundException('文章不存在');
    const slug = await this.availableSlug(input.slug || input.title, id);
    const prepared = await this.prepareRevision({ ...input, slug }, id);
    const latest = await this.prisma.seoArticleRevision.findFirst({
      where: { articleId: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const revision = await tx.seoArticleRevision.create({
        data: {
          articleId: id,
          version: (latest?.version ?? 0) + 1,
          source: SeoRevisionSource.MANUAL,
          slug,
          ...prepared,
          sourceEvidence: this.retainSourceEvidence(
            article.draftRevision?.sourceEvidence,
            tiptapPlainText(prepared.contentJson as unknown as TiptapNode),
          ),
          aiAudit: Prisma.JsonNull,
          lastVerifiedAt: null,
          createdById: actorId,
        },
      });
      await tx.seoArticle.update({
        where: { id },
        data: {
          category: input.category.trim(),
          draftRevisionId: revision.id,
          status: article.publishedRevisionId
            ? SeoArticleStatus.PUBLISHED
            : SeoArticleStatus.DRAFT,
          scheduledAt: null,
          archivedAt: null,
        },
      });
    });
    return this.getAdminArticle(id);
  }

  async publishArticle(id: string, actorId?: string, now = new Date()) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { id },
      include: { draftRevision: true, publishedRevision: true },
    });
    if (!article?.draftRevision)
      throw new NotFoundException('没有可发布的文章草稿');
    const report = article.draftRevision
      .qualityReport as unknown as SeoQualityReport;
    if (report.passed !== true || report.blockers?.length) {
      throw new BadRequestException('文章尚未通过质量检查');
    }
    const operation = article.publishedRevision
      ? SeoIndexOperation.UPDATE
      : SeoIndexOperation.PUBLISH;
    const [indexNow, google] = await Promise.all([
      this.settings.get('seo.indexNowEnabled'),
      this.settings.get('seo.googleEnabled'),
    ]);
    const url = `${webPublicUrl()}/blog/${article.draftRevision.slug}`;
    const submissions = [
      ...(indexNow === 'true' ? [SeoIndexEngine.BING_INDEXNOW] : []),
      ...(google === 'true' ? [SeoIndexEngine.GOOGLE_SITEMAP] : []),
    ].map((engine) => ({
      articleId: article.id,
      revisionId: article.draftRevision!.id,
      engine,
      operation,
      status: SeoIndexStatus.PENDING,
      url,
      idempotencyKey: `${engine}:${article.draftRevision!.id}:${operation}`,
    }));
    const result = await this.prisma.$transaction(async (tx) => {
      if (
        article.publishedRevision &&
        article.slug !== article.draftRevision!.slug
      ) {
        await tx.seoRedirect.deleteMany({
          where: { articleId: id, fromSlug: article.draftRevision!.slug },
        });
        await tx.seoRedirect.updateMany({
          where: { articleId: id },
          data: { toSlug: article.draftRevision!.slug },
        });
        await tx.seoRedirect.upsert({
          where: { fromSlug: article.slug },
          create: {
            articleId: id,
            fromSlug: article.slug,
            toSlug: article.draftRevision!.slug,
          },
          update: { articleId: id, toSlug: article.draftRevision!.slug },
        });
      }
      if (actorId) {
        await tx.seoArticleRevision.update({
          where: { id: article.draftRevision!.id },
          data: { reviewedById: actorId, reviewedAt: now },
        });
      }
      const updated = await tx.seoArticle.update({
        where: { id },
        data: {
          slug: article.draftRevision!.slug,
          status: SeoArticleStatus.PUBLISHED,
          publishedRevisionId: article.draftRevision!.id,
          draftRevisionId: null,
          publishedAt: article.publishedAt ?? now,
          scheduledAt: null,
          archivedAt: null,
        },
      });
      if (submissions.length) {
        await tx.seoIndexSubmission.createMany({
          data: submissions,
          skipDuplicates: true,
        });
      }
      return updated;
    });
    await this.cache.del(publicArticlesCacheKey);
    return result;
  }

  async scheduleArticle(id: string, scheduledAt: Date, actorId: string) {
    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('计划发布时间必须晚于当前时间');
    }
    const article = await this.requirePublishableDraft(id);
    await this.prisma.seoArticleRevision.update({
      where: { id: article.draftRevision!.id },
      data: { reviewedById: actorId, reviewedAt: new Date() },
    });
    return this.prisma.seoArticle.update({
      where: { id },
      data: { status: SeoArticleStatus.SCHEDULED, scheduledAt },
    });
  }

  async archiveArticle(id: string, now = new Date()) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { id },
      include: { publishedRevision: true },
    });
    if (!article) throw new NotFoundException('文章不存在');
    const [indexNow, google] = await Promise.all([
      this.settings.get('seo.indexNowEnabled'),
      this.settings.get('seo.googleEnabled'),
    ]);
    await this.prisma.$transaction(async (tx) => {
      await tx.seoArticle.update({
        where: { id },
        data: {
          status: SeoArticleStatus.ARCHIVED,
          archivedAt: now,
          scheduledAt: null,
        },
      });
      if (article.publishedRevisionId) {
        const engines = [
          ...(indexNow === 'true' ? [SeoIndexEngine.BING_INDEXNOW] : []),
          ...(google === 'true' ? [SeoIndexEngine.GOOGLE_SITEMAP] : []),
        ];
        if (engines.length) {
          await tx.seoIndexSubmission.createMany({
            data: engines.map((engine) => ({
              articleId: id,
              revisionId: article.publishedRevisionId,
              engine,
              operation: SeoIndexOperation.ARCHIVE,
              url: `${webPublicUrl()}/blog/${article.slug}`,
              idempotencyKey: `${engine}:${article.publishedRevisionId}:ARCHIVE`,
            })),
            skipDuplicates: true,
          });
        }
      }
    });
    await this.cache.del(publicArticlesCacheKey);
    return { success: true };
  }

  async restoreRevision(
    articleId: string,
    revisionId: string,
    actorId: string,
  ) {
    const source = await this.prisma.seoArticleRevision.findFirst({
      where: { id: revisionId, articleId },
    });
    if (!source) throw new NotFoundException('文章版本不存在');
    const latest = await this.prisma.seoArticleRevision.findFirst({
      where: { articleId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const restored = await this.prisma.seoArticleRevision.create({
      data: {
        articleId,
        version: (latest?.version ?? 0) + 1,
        source: SeoRevisionSource.MANUAL,
        slug: source.slug,
        title: source.title,
        excerpt: source.excerpt,
        contentJson: source.contentJson as Prisma.InputJsonValue,
        contentHtml: source.contentHtml,
        primaryKeyword: source.primaryKeyword,
        relatedKeywords: source.relatedKeywords,
        tags: source.tags,
        seoTitle: source.seoTitle,
        metaDescription: source.metaDescription,
        coverImageId: source.coverImageId,
        coverAlt: source.coverAlt,
        qualityScore: source.qualityScore,
        qualityReport: source.qualityReport as Prisma.InputJsonValue,
        sourceEvidence:
          source.sourceEvidence === null
            ? Prisma.JsonNull
            : (source.sourceEvidence as Prisma.InputJsonValue),
        aiAudit:
          source.aiAudit === null
            ? Prisma.JsonNull
            : (source.aiAudit as Prisma.InputJsonValue),
        lastVerifiedAt: source.lastVerifiedAt,
        createdById: actorId,
      },
    });
    await this.prisma.seoArticle.update({
      where: { id: articleId },
      data: {
        draftRevisionId: restored.id,
        scheduledAt: null,
        archivedAt: null,
      },
    });
    return this.getAdminArticle(articleId);
  }

  async queueGeneration(
    keywordId: string | undefined,
    actorId?: string,
    now = new Date(),
  ) {
    const keyword = keywordId
      ? await this.requireKeyword(keywordId)
      : await this.prisma.seoKeyword.findFirst({
          where: { status: SeoKeywordStatus.ACTIVE, articleId: null },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
    if (
      !keyword ||
      keyword.status !== SeoKeywordStatus.ACTIVE ||
      keyword.articleId
    ) {
      throw new BadRequestException('没有可用于生成的有效关键词');
    }
    return this.prisma.seoGenerationJob.upsert({
      where: {
        idempotencyKey: `manual:${actorId ?? 'system'}:${keyword.id}:${now.toISOString()}`,
      },
      create: {
        keywordId: keyword.id,
        requestedById: actorId,
        idempotencyKey: `manual:${actorId ?? 'system'}:${keyword.id}:${now.toISOString()}`,
        scheduledFor: now,
      },
      update: {},
    });
  }

  async retryGeneration(id: string) {
    const job = await this.prisma.seoGenerationJob.findUnique({
      where: { id },
    });
    if (!job) throw new NotFoundException('生成任务不存在');
    if (job.status !== SeoGenerationStatus.FAILED) {
      throw new ConflictException('只有失败的生成任务可以重试');
    }
    return this.prisma.seoGenerationJob.update({
      where: { id },
      data: {
        status: SeoGenerationStatus.QUEUED,
        scheduledFor: new Date(),
        lastError: null,
        startedAt: null,
        finishedAt: null,
      },
    });
  }

  async retryIndexSubmission(id: string) {
    const submission = await this.prisma.seoIndexSubmission.findUnique({
      where: { id },
    });
    if (!submission) throw new NotFoundException('索引任务不存在');
    if (submission.status !== SeoIndexStatus.FAILED) {
      throw new ConflictException('只有失败的索引任务可以重试');
    }
    return this.prisma.seoIndexSubmission.update({
      where: { id },
      data: {
        status: SeoIndexStatus.PENDING,
        attempts: 0,
        nextRetryAt: null,
        response: Prisma.DbNull,
        lastError: null,
        submittedAt: null,
      },
    });
  }

  async workerTick(now = new Date()) {
    const recovered = await this.recoverStaleWorkerTasks(now);
    const scheduledJobs = await this.createScheduledGeneration(now);
    const generated = await this.processGenerationJobs(now);
    const published = await this.publishScheduledArticles(now);
    const indexed = await this.processIndexSubmissions(now);
    const metrics = await this.syncSearchConsoleIfDue(now);
    return {
      recovered,
      scheduledJobs,
      generated,
      published,
      indexed,
      metrics,
    };
  }

  async listPublishedArticles(query: SeoListQueryDto) {
    const { page, pageSize, skip } = parsePage(query, {
      defaultPageSize: 9,
      maxPageSize: 30,
    });
    const where: Prisma.SeoArticleWhereInput = {
      publishedRevisionId: { not: null },
      archivedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.tag ? { publishedRevision: { tags: { has: query.tag } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.seoArticle.findMany({
        where,
        include: { publishedRevision: { include: { coverImage: true } } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.seoArticle.count({ where }),
    ]);
    return pageResponse(
      items.map((item) => this.serializePublicArticle(item, false)),
      total,
      page,
      pageSize,
    );
  }

  async getPublishedArticle(slug: string) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { slug },
      include: { publishedRevision: { include: { coverImage: true } } },
    });
    if (!article || !article.publishedRevision || article.archivedAt) {
      const redirect = await this.prisma.seoRedirect.findUnique({
        where: { fromSlug: slug },
      });
      if (redirect) return { redirectTo: redirect.toSlug } as const;
      throw new NotFoundException('文章不存在');
    }
    const related = await this.prisma.seoArticle.findMany({
      where: {
        id: { not: article.id },
        category: article.category,
        publishedRevisionId: { not: null },
        archivedAt: null,
      },
      include: { publishedRevision: { include: { coverImage: true } } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    return {
      article: this.serializePublicArticle(article, true),
      related: related.map((item) => this.serializePublicArticle(item, false)),
    };
  }

  async resolvePublishedRedirect(slug: string) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { slug },
      select: { publishedRevisionId: true, archivedAt: true },
    });
    if (article?.publishedRevisionId && !article.archivedAt) {
      return { redirectTo: null };
    }
    const redirect = await this.prisma.seoRedirect.findUnique({
      where: { fromSlug: slug },
      select: { toSlug: true },
    });
    return { redirectTo: redirect?.toSlug ?? null };
  }

  async sitemapEntries() {
    return this.prisma.seoArticle.findMany({
      where: { publishedRevisionId: { not: null }, archivedAt: null },
      select: { slug: true, updatedAt: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async indexNowKey() {
    return (await this.settings.get('seo.indexNowKey')) ?? '';
  }

  async uploadImage(file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择图片');
    if (file.size > seoImageMaxBytes)
      throw new BadRequestException('图片不能超过 20 MB');
    const image = await this.saveImageBuffer(
      file.buffer,
      SeoImageSource.UPLOAD,
      file.originalname,
    );
    return { ...image, url: this.imagePublicUrl(image.id) };
  }

  async imageAsset(id: string) {
    const image = await this.prisma.seoImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException('图片不存在');
    const root = seoImageDirectory();
    const path = resolve(root, image.storageKey);
    const fromRoot = relative(root, path);
    if (
      !fromRoot ||
      fromRoot.startsWith('..') ||
      resolve(root, fromRoot) !== path
    ) {
      throw new BadRequestException('图片路径无效');
    }
    return {
      path,
      mimeType: image.mimeType,
      etag: `"${image.storageKey}"`,
    };
  }

  async regenerateCover(articleId: string, actorId: string) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { id: articleId },
      include: { draftRevision: true },
    });
    if (!article?.draftRevision)
      throw new NotFoundException('没有可编辑的文章草稿');
    const image = await this.saveImageBuffer(
      await this.ai.generateCover(
        `${article.draftRevision.title}. ${article.draftRevision.primaryKeyword}`,
      ),
      SeoImageSource.AI,
      null,
    );
    const source = article.draftRevision;
    const prepared = await this.prepareRevision(
      {
        slug: source.slug,
        category: article.category,
        title: source.title,
        excerpt: source.excerpt,
        contentJson: source.contentJson as Record<string, unknown>,
        primaryKeyword: source.primaryKeyword,
        relatedKeywords: source.relatedKeywords,
        tags: source.tags,
        seoTitle: source.seoTitle,
        metaDescription: source.metaDescription,
        coverImageId: image.id,
        coverAlt: source.coverAlt ?? undefined,
      },
      articleId,
    );
    const latest = await this.prisma.seoArticleRevision.findFirst({
      where: { articleId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const revision = await this.prisma.$transaction(async (tx) => {
      const created = await tx.seoArticleRevision.create({
        data: {
          articleId,
          version: (latest?.version ?? 0) + 1,
          source: SeoRevisionSource.MANUAL,
          slug: source.slug,
          ...prepared,
          modelSnapshot:
            source.modelSnapshot === null
              ? Prisma.JsonNull
              : (source.modelSnapshot as Prisma.InputJsonValue),
          promptVersion: source.promptVersion,
          sourceEvidence:
            source.sourceEvidence === null
              ? Prisma.JsonNull
              : (source.sourceEvidence as Prisma.InputJsonValue),
          aiAudit:
            source.aiAudit === null
              ? Prisma.JsonNull
              : (source.aiAudit as Prisma.InputJsonValue),
          lastVerifiedAt: source.lastVerifiedAt,
          createdById: actorId,
        },
      });
      await tx.seoArticle.update({
        where: { id: articleId },
        data: {
          draftRevisionId: created.id,
          status: article.publishedRevisionId
            ? SeoArticleStatus.PUBLISHED
            : SeoArticleStatus.DRAFT,
          scheduledAt: null,
          archivedAt: null,
        },
      });
      return created;
    });
    return {
      ...image,
      revisionId: revision.id,
      qualityReport: revision.qualityReport,
      url: this.imagePublicUrl(image.id),
    };
  }

  async analytics() {
    const now = new Date();
    const start = new Date(now.getTime() - 56 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.seoSearchMetric.findMany({
      where: { date: { gte: start } },
      orderBy: [{ date: 'asc' }, { impressions: 'desc' }],
      take: 25_000,
    });
    const cutoff = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const summarize = (values: typeof rows) => {
      const clicks = values.reduce((sum, row) => sum + row.clicks, 0);
      const impressions = values.reduce((sum, row) => sum + row.impressions, 0);
      const weightedPosition = values.reduce(
        (sum, row) => sum + row.position * row.impressions,
        0,
      );
      return {
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0,
        position: impressions ? weightedPosition / impressions : 0,
      };
    };
    const current = rows.filter((row) => row.date >= cutoff);
    const previous = rows.filter((row) => row.date < cutoff);
    const topQueries = this.groupMetrics(current, 'query').slice(0, 10);
    const topPages = this.groupMetrics(current, 'page').slice(0, 10);
    const lowCtrPages = this.groupMetrics(current, 'page')
      .filter((item) => item.impressions >= 100 && item.ctr < 0.03)
      .slice(0, 10);
    return {
      current: summarize(current),
      previous: summarize(previous),
      topQueries,
      topPages,
      highImpressionQueries: topQueries,
      lowCtrPages,
    };
  }

  async listJobs() {
    const [generation, indexing] = await Promise.all([
      this.prisma.seoGenerationJob.findMany({
        include: { keyword: true, article: { select: { slug: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.seoIndexSubmission.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    ]);
    return { generation, indexing };
  }

  private async prepareRevision(
    input: SaveSeoArticleDto,
    articleId: string | null,
  ) {
    const contentJson = input.contentJson as unknown as TiptapNode;
    if (contentJson.type !== 'doc')
      throw new BadRequestException('文章正文格式无效');
    const articles = await this.prisma.seoArticle.findMany({
      where: articleId ? { id: { not: articleId } } : undefined,
      include: { draftRevision: true, publishedRevision: true },
      take: 200,
    });
    const existingRevisions = articles.flatMap((article) =>
      [article.draftRevision, article.publishedRevision].filter(
        (revision): revision is NonNullable<typeof revision> =>
          Boolean(revision),
      ),
    );
    const existingPlainTexts = existingRevisions.map((revision) =>
      tiptapPlainText(revision.contentJson as unknown as TiptapNode),
    );
    if (input.coverImageId) {
      const image = await this.prisma.seoImage.findUnique({
        where: { id: input.coverImageId },
      });
      if (!image) throw new BadRequestException('封面图片不存在');
    }
    const report = evaluateSeoDraft({
      title: input.title,
      excerpt: input.excerpt,
      primaryKeyword: input.primaryKeyword,
      relatedKeywords: input.relatedKeywords,
      tags: input.tags,
      seoTitle: input.seoTitle,
      metaDescription: input.metaDescription,
      coverImageId: input.coverImageId ?? null,
      coverAlt: input.coverAlt ?? null,
      contentJson,
      existingPlainTexts,
      existingSeoTitles: existingRevisions.map((revision) => revision.seoTitle),
      existingMetaDescriptions: existingRevisions.map(
        (revision) => revision.metaDescription,
      ),
    });
    return {
      title: input.title.trim(),
      excerpt: input.excerpt.trim(),
      contentJson: contentJson as unknown as Prisma.InputJsonValue,
      contentHtml: renderTiptapHtml(contentJson),
      primaryKeyword: input.primaryKeyword.trim(),
      relatedKeywords: input.relatedKeywords
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 12),
      tags: input.tags
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 8),
      seoTitle: input.seoTitle.trim(),
      metaDescription: input.metaDescription.trim(),
      coverImageId: input.coverImageId || null,
      coverAlt: input.coverAlt?.trim() || null,
      qualityScore: report.score,
      qualityReport: report as unknown as Prisma.InputJsonValue,
    };
  }

  private async createArticleFromGenerated(
    generated: GeneratedArticleDraft,
    keyword: { id: string; category: string },
    imageId: string | null,
    modelSnapshot: Prisma.InputJsonValue,
    targetArticleId?: string | null,
  ) {
    const contentJson = buildGeneratedDocument({
      lead: generated.lead,
      sections: generated.sections,
    });
    const existingArticle = targetArticleId
      ? await this.prisma.seoArticle.findUnique({
          where: { id: targetArticleId },
          select: { id: true, publishedRevisionId: true },
        })
      : null;
    if (targetArticleId && !existingArticle) {
      throw new NotFoundException('重试任务关联的文章不存在');
    }
    const latest = existingArticle
      ? await this.prisma.seoArticleRevision.findFirst({
          where: { articleId: existingArticle.id },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
      : null;
    const slug = await this.availableSlug(generated.title, existingArticle?.id);
    const prepared = await this.prepareRevision(
      {
        slug,
        category: keyword.category,
        title: generated.title,
        excerpt: generated.excerpt,
        contentJson,
        primaryKeyword: generated.primaryKeyword,
        relatedKeywords: generated.relatedKeywords,
        tags: generated.tags,
        seoTitle: generated.seoTitle,
        metaDescription: generated.metaDescription,
        coverImageId: imageId ?? undefined,
        coverAlt: imageId ? generated.coverAlt : undefined,
      },
      existingArticle?.id ?? null,
    );
    const qualityReport = applyEditorialAudit(
      prepared.qualityReport as unknown as SeoQualityReport,
      generated.audit,
    );
    return this.prisma.$transaction(async (tx) => {
      const article = existingArticle
        ? existingArticle
        : await tx.seoArticle.create({
            data: { slug, category: keyword.category },
          });
      const revision = await tx.seoArticleRevision.create({
        data: {
          articleId: article.id,
          version: (latest?.version ?? 0) + 1,
          source: SeoRevisionSource.AI,
          slug,
          ...prepared,
          qualityScore: qualityReport.score,
          qualityReport,
          modelSnapshot,
          promptVersion,
          sourceEvidence: generated.sourceEvidence,
          aiAudit: generated.audit,
          lastVerifiedAt: new Date(generated.audit.checkedAt),
        },
      });
      const updatedArticle = await tx.seoArticle.update({
        where: { id: article.id },
        data: {
          category: keyword.category,
          draftRevisionId: revision.id,
          status: existingArticle?.publishedRevisionId
            ? SeoArticleStatus.PUBLISHED
            : SeoArticleStatus.DRAFT,
          scheduledAt: null,
          archivedAt: null,
        },
      });
      await tx.seoKeyword.update({
        where: { id: keyword.id },
        data: {
          status: SeoKeywordStatus.USED,
          articleId: article.id,
          lastGeneratedAt: new Date(),
        },
      });
      return {
        article: updatedArticle,
        revision,
        report: revision.qualityReport as unknown as SeoQualityReport,
      };
    });
  }

  private async createScheduledGeneration(now: Date) {
    if ((await this.settings.get('seo.enabled')) !== 'true') return 0;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const weekday =
      { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
        value('weekday')
      ] ?? -1;
    const days = this.parseScheduleDays(
      await this.settings.get('seo.scheduleDays'),
    );
    const hour = Number((await this.settings.get('seo.scheduleHour')) ?? 10);
    if (!days.includes(weekday) || Number(value('hour')) < hour) return 0;
    const date = `${value('year')}-${value('month')}-${value('day')}`;
    const idempotencyKey = `schedule:${date}`;
    const existing = await this.prisma.seoGenerationJob.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return 0;
    const keyword = await this.prisma.seoKeyword.findFirst({
      where: { status: SeoKeywordStatus.ACTIVE, articleId: null },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!keyword) return 0;
    try {
      await this.prisma.seoGenerationJob.create({
        data: { keywordId: keyword.id, idempotencyKey, scheduledFor: now },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 0;
      }
      throw error;
    }
    return 1;
  }

  private async recoverStaleWorkerTasks(now: Date) {
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    const [generation, indexing] = await Promise.all([
      this.prisma.seoGenerationJob.updateMany({
        where: {
          status: SeoGenerationStatus.RUNNING,
          updatedAt: { lte: staleBefore },
        },
        data: {
          status: SeoGenerationStatus.QUEUED,
          scheduledFor: now,
          startedAt: null,
          finishedAt: null,
          lastError: '工作进程中断，任务已自动重新排队',
        },
      }),
      this.prisma.seoIndexSubmission.updateMany({
        where: {
          status: SeoIndexStatus.RUNNING,
          updatedAt: { lte: staleBefore },
        },
        data: {
          status: SeoIndexStatus.FAILED,
          nextRetryAt: now,
          lastError: '工作进程中断，任务已自动恢复',
        },
      }),
    ]);
    return generation.count + indexing.count;
  }

  private async processGenerationJobs(now: Date) {
    const jobs = await this.prisma.seoGenerationJob.findMany({
      where: { status: SeoGenerationStatus.QUEUED, scheduledFor: { lte: now } },
      include: { keyword: true },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: 3,
    });
    let completed = 0;
    for (const job of jobs) {
      const claimed = await this.prisma.seoGenerationJob.updateMany({
        where: { id: job.id, status: SeoGenerationStatus.QUEUED },
        data: {
          status: SeoGenerationStatus.RUNNING,
          startedAt: now,
          attempts: { increment: 1 },
          promptVersion,
        },
      });
      if (!claimed.count || !job.keyword) continue;
      try {
        const textStartedAt = Date.now();
        const [tutorials, site, existing] = await Promise.all([
          this.settings.getTutorialConfig(),
          this.settings.getSiteInfo(),
          this.prisma.seoArticle.findMany({
            where: { publishedRevisionId: { not: null }, archivedAt: null },
            include: {
              publishedRevision: {
                select: { title: true, primaryKeyword: true },
              },
            },
            take: 100,
          }),
        ]);
        const generated = await this.ai.generateArticle({
          keyword: job.keyword.keyword,
          category: job.keyword.category,
          searchIntent: job.keyword.searchIntent,
          sources: this.buildPublicSources(site, tutorials, new Date()),
          existingArticles: existing.flatMap((article) =>
            article.publishedRevision
              ? [
                  {
                    title: article.publishedRevision.title,
                    slug: article.slug,
                    primaryKeyword: article.publishedRevision.primaryKeyword,
                  },
                ]
              : [],
          ),
        });
        const textDurationMs = Date.now() - textStartedAt;
        let imageId: string | null = null;
        let imageError: string | null = null;
        const imageStartedAt = Date.now();
        try {
          imageId = (
            await this.saveImageBuffer(
              await this.ai.generateCover(generated.article.imagePrompt),
              SeoImageSource.AI,
              null,
            )
          ).id;
        } catch (error) {
          imageError = this.cleanError(error);
        }
        const imageUsage = {
          status: imageId ? 'succeeded' : 'failed',
          prompt: generated.article.imagePrompt,
          durationMs: Date.now() - imageStartedAt,
          error: imageError,
        };
        const created = await this.createArticleFromGenerated(
          generated.article,
          job.keyword,
          imageId,
          generated.modelSnapshot,
          job.articleId ?? job.keyword.articleId,
        );
        const passed = created.report.passed === true;
        await this.prisma.seoGenerationJob.update({
          where: { id: job.id },
          data: {
            articleId: created.article.id,
            status: passed
              ? SeoGenerationStatus.SUCCEEDED
              : SeoGenerationStatus.FAILED,
            modelSnapshot: generated.modelSnapshot,
            usage: {
              ...generated.usage,
              textDurationMs,
              image: imageUsage,
            },
            lastError: passed
              ? imageError
                ? `正文已生成，封面失败：${imageError}`
                : null
              : `质量检查未通过：${created.report.blockers.join('；')}`,
            finishedAt: new Date(),
          },
        });
        completed += 1;
      } catch (error) {
        await this.prisma.seoGenerationJob.update({
          where: { id: job.id },
          data: {
            status: SeoGenerationStatus.FAILED,
            lastError: this.cleanError(error),
            finishedAt: new Date(),
          },
        });
      }
    }
    return completed;
  }

  private async publishScheduledArticles(now: Date) {
    const articles = await this.prisma.seoArticle.findMany({
      where: {
        status: SeoArticleStatus.SCHEDULED,
        scheduledAt: { lte: now },
        draftRevisionId: { not: null },
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    let count = 0;
    for (const article of articles) {
      try {
        await this.publishArticle(article.id, undefined, now);
        count += 1;
      } catch {
        await this.prisma.seoArticle.update({
          where: { id: article.id },
          data: {
            status: article.publishedRevisionId
              ? SeoArticleStatus.PUBLISHED
              : SeoArticleStatus.DRAFT,
            scheduledAt: null,
          },
        });
      }
    }
    return count;
  }

  private async processIndexSubmissions(now: Date) {
    const jobs = await this.prisma.seoIndexSubmission.findMany({
      where: {
        status: { in: [SeoIndexStatus.PENDING, SeoIndexStatus.FAILED] },
        attempts: { lt: 6 },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    let completed = 0;
    for (const job of jobs) {
      const claimed = await this.prisma.seoIndexSubmission.updateMany({
        where: {
          id: job.id,
          status: { in: [SeoIndexStatus.PENDING, SeoIndexStatus.FAILED] },
        },
        data: { status: SeoIndexStatus.RUNNING, attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        const response =
          job.engine === SeoIndexEngine.BING_INDEXNOW
            ? await this.search.submitIndexNow(job.url)
            : await this.search.submitGoogleSitemap();
        await this.prisma.seoIndexSubmission.update({
          where: { id: job.id },
          data: {
            status: SeoIndexStatus.SUCCEEDED,
            response,
            submittedAt: new Date(),
            nextRetryAt: null,
            lastError: null,
          },
        });
        completed += 1;
      } catch (error) {
        const attempts = job.attempts + 1;
        await this.prisma.seoIndexSubmission.update({
          where: { id: job.id },
          data: {
            status: SeoIndexStatus.FAILED,
            lastError: this.cleanError(error),
            nextRetryAt: new Date(now.getTime() + 2 ** attempts * 60_000),
          },
        });
      }
    }
    return completed;
  }

  private async syncSearchConsoleIfDue(now: Date) {
    if ((await this.settings.get('seo.googleEnabled')) !== 'true') return 0;
    const date = now.toISOString().slice(0, 10);
    const syncKey = `seo.googleLastSyncDate`;
    if ((await this.settings.get(syncKey)) === date || now.getUTCHours() < 20)
      return 0;
    const end = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - 89 * 24 * 60 * 60 * 1000);
    const rows = await this.search.fetchGoogleMetrics(
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    );
    const articles = await this.prisma.seoArticle.findMany({
      select: { id: true, slug: true },
    });
    const bySlug = new Map(
      articles.map((article) => [article.slug, article.id]),
    );
    for (const row of rows) {
      const slug = this.slugFromPage(row.page);
      const fingerprint = createHash('sha256')
        .update(`${row.date}\n${row.page}\n${row.query}`)
        .digest('hex');
      await this.prisma.seoSearchMetric.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          articleId: slug ? bySlug.get(slug) : undefined,
          date: new Date(`${row.date}T00:00:00.000Z`),
          page: row.page,
          query: row.query,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        },
        update: {
          articleId: slug ? bySlug.get(slug) : undefined,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        },
      });
    }
    await this.settings.setMany({ [syncKey]: date });
    return rows.length;
  }

  private async saveImageBuffer(
    buffer: Buffer,
    source: SeoImageSource,
    originalName: string | null,
  ) {
    const storageKey = `${randomUUID()}.webp`;
    await mkdir(seoImageDirectory(), { recursive: true });
    const path = join(seoImageDirectory(), storageKey);
    const output = await sharp(buffer)
      .resize(1600, 900, { fit: 'cover', position: 'attention' })
      .webp({ quality: 84 })
      .toBuffer();
    if (output.length > seoImageMaxBytes)
      throw new BadRequestException('处理后的图片超过大小限制');
    await writeFile(path, output);
    try {
      return await this.prisma.seoImage.create({
        data: {
          storageKey,
          source,
          width: 1600,
          height: 900,
          sizeBytes: output.length,
          originalName,
        },
      });
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  private async requireKeyword(id: string) {
    const keyword = await this.prisma.seoKeyword.findUnique({ where: { id } });
    if (!keyword) throw new NotFoundException('关键词不存在');
    return keyword;
  }

  private async requirePublishableDraft(id: string) {
    const article = await this.prisma.seoArticle.findUnique({
      where: { id },
      include: { draftRevision: true },
    });
    if (!article?.draftRevision)
      throw new NotFoundException('没有可发布的文章草稿');
    const report = article.draftRevision
      .qualityReport as unknown as SeoQualityReport;
    if (!report.passed || report.blockers?.length)
      throw new BadRequestException('文章尚未通过质量检查');
    return article;
  }

  private async availableSlug(value: string, articleId?: string) {
    const base = slugifyArticleTitle(value) || `article-${Date.now()}`;
    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const slug = suffix === 1 ? base : `${base}-${suffix}`;
      const [article, redirect] = await Promise.all([
        this.prisma.seoArticle.findFirst({
          where: { slug, ...(articleId ? { id: { not: articleId } } : {}) },
          select: { id: true },
        }),
        this.prisma.seoRedirect.findUnique({
          where: { fromSlug: slug },
          select: { id: true },
        }),
      ]);
      if (!article && !redirect) return slug;
    }
    throw new ConflictException('无法生成唯一的文章地址');
  }

  private buildPublicSources(
    site: unknown,
    tutorials: unknown,
    accessedAt: Date,
  ): SeoPublicSource[] {
    const timestamp = accessedAt.toISOString();
    const tutorialConfig = this.record(tutorials);
    const platforms = Array.isArray(tutorialConfig?.platforms)
      ? tutorialConfig.platforms
      : [];
    return [
      {
        id: 'site-info',
        title: '站点公开信息',
        url: `${apiPublicUrl()}/api/site`,
        content: JSON.stringify(site).slice(0, 12_000),
        accessedAt: timestamp,
        applicableVersion: '生成时的后台公开配置',
      },
      ...platforms.flatMap((value, index) => {
        const platform = this.record(value);
        if (!platform) return [];
        const id =
          typeof platform.id === 'string' && platform.id.trim()
            ? platform.id.trim()
            : `platform-${index + 1}`;
        return [
          {
            id: `tutorial-${id}`,
            title:
              typeof platform.name === 'string' && platform.name.trim()
                ? `${platform.name.trim()} 使用教程`
                : `${id} 使用教程`,
            url: `${apiPublicUrl()}/api/tutorial-assets#${encodeURIComponent(id)}`,
            content: JSON.stringify(platform).slice(0, 12_000),
            accessedAt: timestamp,
            applicableVersion:
              typeof platform.client === 'string' && platform.client.trim()
                ? platform.client.trim()
                : '生成时的后台公开教程',
          },
        ];
      }),
    ];
  }

  private retainSourceEvidence(value: unknown, content: string) {
    if (!Array.isArray(value)) return Prisma.JsonNull;
    const normalize = (input: string) =>
      input.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    const normalizedContent = normalize(content);
    const retained = value.filter((item) => {
      const evidence = this.record(item);
      return (
        evidence &&
        typeof evidence.claim === 'string' &&
        normalizedContent.includes(normalize(evidence.claim))
      );
    });
    return retained.length
      ? (retained as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private parseScheduleDays(value?: string) {
    const parsed = (value ?? '1,4')
      .split(',')
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    return parsed.length ? [...new Set(parsed)] : [1, 4];
  }

  private serializeAdminArticle(article: AdminArticleRecord) {
    const revision = article.draftRevision ?? article.publishedRevision;
    return {
      ...article,
      currentRevision: revision ? this.serializeRevision(revision) : null,
      draftRevision: article.draftRevision
        ? this.serializeRevision(article.draftRevision)
        : null,
      publishedRevision: article.publishedRevision
        ? this.serializeRevision(article.publishedRevision)
        : null,
    };
  }

  private serializeRevision(revision: SeoArticleRevision) {
    return {
      ...revision,
      coverUrl: revision.coverImageId
        ? this.imagePublicUrl(revision.coverImageId)
        : null,
    };
  }

  private serializePublicArticle(
    article: PublicArticleRecord,
    includeContent: boolean,
  ) {
    const revision = article.publishedRevision;
    if (!revision) {
      throw new NotFoundException('文章没有可公开的版本');
    }
    const sourceReferences = Array.isArray(revision.sourceEvidence)
      ? revision.sourceEvidence.flatMap((value) => {
          const source = this.record(value);
          if (
            !source ||
            typeof source.sourceTitle !== 'string' ||
            typeof source.sourceUrl !== 'string'
          ) {
            return [];
          }
          return [
            {
              title: source.sourceTitle,
              url: source.sourceUrl,
              applicableVersion:
                typeof source.applicableVersion === 'string'
                  ? source.applicableVersion
                  : null,
            },
          ];
        })
      : [];
    const uniqueSources = [
      ...new Map(
        sourceReferences.map((source) => [source.url, source]),
      ).values(),
    ];
    return {
      id: article.id,
      slug: article.slug,
      category: article.category,
      title: revision.title,
      excerpt: revision.excerpt,
      tags: revision.tags,
      seoTitle: revision.seoTitle,
      metaDescription: revision.metaDescription,
      coverUrl: revision.coverImageId
        ? this.imagePublicUrl(revision.coverImageId)
        : null,
      coverAlt: revision.coverAlt,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      updatedAt: article.updatedAt.toISOString(),
      reviewedAt: revision.reviewedAt?.toISOString() ?? null,
      lastVerifiedAt: revision.lastVerifiedAt?.toISOString() ?? null,
      sources: includeContent ? uniqueSources : [],
      author: '素心 Network 编辑部',
      ...(includeContent ? { contentHtml: revision.contentHtml } : {}),
      ...(includeContent
        ? {
            tableOfContents: extractTiptapHeadings(
              revision.contentJson as unknown as TiptapNode,
            ),
          }
        : {}),
    };
  }

  private groupMetrics(
    rows: Array<{
      query: string;
      page: string;
      clicks: number;
      impressions: number;
      position: number;
    }>,
    field: 'query' | 'page',
  ) {
    const grouped = new Map<
      string,
      {
        value: string;
        clicks: number;
        impressions: number;
        positionWeight: number;
      }
    >();
    for (const row of rows) {
      const key = row[field];
      const current = grouped.get(key) ?? {
        value: key,
        clicks: 0,
        impressions: 0,
        positionWeight: 0,
      };
      current.clicks += row.clicks;
      current.impressions += row.impressions;
      current.positionWeight += row.position * row.impressions;
      grouped.set(key, current);
    }
    return [...grouped.values()]
      .map((item) => ({
        value: item.value,
        clicks: item.clicks,
        impressions: item.impressions,
        ctr: item.impressions ? item.clicks / item.impressions : 0,
        position: item.impressions ? item.positionWeight / item.impressions : 0,
      }))
      .sort((left, right) => right.impressions - left.impressions);
  }

  private slugFromPage(page: string) {
    try {
      const match = new URL(page).pathname.match(/^\/blog\/([^/]+)\/?$/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  private imagePublicUrl(id: string) {
    return `${apiPublicUrl()}/api/seo/images/${encodeURIComponent(id)}`;
  }

  private cleanError(error: unknown) {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      500,
    );
  }
}
