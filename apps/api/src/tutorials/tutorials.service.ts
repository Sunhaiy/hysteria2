import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TutorialPlatform,
  TutorialRevisionStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { SaveTutorialDraftDto } from './tutorials.dto';

const publishedCacheKey = 'tutorials:published:v1';
const maxImageBytes = 10 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const defaults = {
  windows: {
    platform: TutorialPlatform.WINDOWS,
    name: 'Windows',
    meta: '电脑',
    clientName: 'Clash Verge Rev',
  },
  macos: {
    platform: TutorialPlatform.MACOS,
    name: 'macOS',
    meta: 'Mac',
    clientName: 'Clash Verge Rev',
  },
  android: {
    platform: TutorialPlatform.ANDROID,
    name: 'Android',
    meta: '手机 / 平板',
    clientName: 'FlClash',
  },
  ios: {
    platform: TutorialPlatform.IOS,
    name: 'iOS',
    meta: 'iPhone / iPad',
    clientName: 'Stash',
  },
} as const;

type PlatformId = keyof typeof defaults;
const platformOrder: Record<PlatformId, number> = {
  windows: 0,
  android: 1,
  macos: 2,
  ios: 3,
};

@Injectable()
export class TutorialsService {
  private defaultsReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
  ) {}

  async published() {
    await this.ensureDefaults();
    const cached = await this.cache.get(publishedCacheKey);
    if (cached) return JSON.parse(cached) as unknown;
    const assets = await this.tutorialAssets();
    const guides = await this.prisma.tutorialGuide.findMany({
      where: { active: true, publishedRevisionId: { not: null } },
      include: {
        publishedRevision: {
          include: {
            steps: {
              include: { image: true },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
      orderBy: { platform: 'asc' },
    });
    const result = {
      platforms: this.sortGuides(guides).map((guide) =>
        this.presentGuide(
          guide,
          guide.publishedRevision,
          assets.get(this.platformId(guide.platform)) ?? null,
        ),
      ),
    };
    await this.cache.set(publishedCacheKey, JSON.stringify(result), 300);
    return result;
  }

  async adminOverview() {
    await this.ensureDefaults();
    const [guides, assets] = await Promise.all([
      this.prisma.tutorialGuide.findMany({
        include: {
          publishedRevision: {
            include: {
              steps: {
                include: { image: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
          revisions: {
            where: { status: TutorialRevisionStatus.DRAFT },
            include: {
              steps: {
                include: { image: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
        orderBy: { platform: 'asc' },
      }),
      this.tutorialAssets(),
    ]);
    return {
      guides: this.sortGuides(guides).map((guide) => ({
        ...this.presentGuide(
          guide,
          guide.publishedRevision,
          assets.get(this.platformId(guide.platform)) ?? null,
        ),
        draft: guide.revisions[0]
          ? this.presentRevision(guide.revisions[0])
          : null,
      })),
    };
  }

  async createDraft(platformValue: string) {
    await this.ensureDefaults();
    const platform = this.parsePlatform(platformValue);
    const guide = await this.prisma.tutorialGuide.findUnique({
      where: { platform },
      include: {
        publishedRevision: {
          include: { steps: { orderBy: { sortOrder: 'asc' } } },
        },
        revisions: {
          where: { status: TutorialRevisionStatus.DRAFT },
          include: {
            steps: { include: { image: true }, orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!guide) throw new NotFoundException('Tutorial guide not found');
    if (guide.revisions[0]) return this.presentRevision(guide.revisions[0]);
    const latest = await this.prisma.tutorialRevision.findFirst({
      where: { guideId: guide.id },
      orderBy: { version: 'desc' },
    });
    const draft = await this.prisma.tutorialRevision.create({
      data: {
        guideId: guide.id,
        version: (latest?.version ?? 0) + 1,
        steps: {
          create: (guide.publishedRevision?.steps ?? []).map((step) => ({
            title: step.title,
            body: step.body,
            imageId: step.imageId,
            sortOrder: step.sortOrder,
          })),
        },
      },
      include: {
        steps: { include: { image: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    return this.presentRevision(draft);
  }

  async saveDraft(
    platformValue: string,
    revisionId: string,
    input: SaveTutorialDraftDto,
  ) {
    if (!input.steps.length || input.steps.length > 50) {
      throw new BadRequestException('Tutorial requires 1 to 50 steps');
    }
    const platform = this.parsePlatform(platformValue);
    const revision = await this.prisma.tutorialRevision.findUnique({
      where: { id: revisionId },
      include: { guide: true },
    });
    if (
      !revision ||
      revision.guide.platform !== platform ||
      revision.status !== TutorialRevisionStatus.DRAFT
    ) {
      throw new NotFoundException('Editable tutorial draft not found');
    }
    const imageIds = input.steps.flatMap((step) =>
      step.imageId ? [step.imageId] : [],
    );
    if (imageIds.length) {
      const imageCount = await this.prisma.tutorialImage.count({
        where: { id: { in: imageIds } },
      });
      if (imageCount !== new Set(imageIds).size)
        throw new BadRequestException('Unknown tutorial image');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.tutorialGuide.update({
        where: { id: revision.guideId },
        data: {
          clientName: input.clientName.trim(),
          meta: input.meta.trim(),
          externalUrl: input.externalUrl?.trim() || null,
          active: input.active,
        },
      });
      await tx.tutorialStep.deleteMany({ where: { revisionId } });
      await tx.tutorialStep.createMany({
        data: input.steps.map((step, sortOrder) => ({
          revisionId,
          title: step.title.trim(),
          body: step.body.trim(),
          imageId: step.imageId || null,
          sortOrder,
        })),
      });
      return tx.tutorialRevision.findUniqueOrThrow({
        where: { id: revisionId },
        include: {
          steps: { include: { image: true }, orderBy: { sortOrder: 'asc' } },
        },
      });
    });
    return this.presentRevision(updated);
  }

  async publish(platformValue: string, revisionId: string) {
    const platform = this.parsePlatform(platformValue);
    const revision = await this.prisma.tutorialRevision.findUnique({
      where: { id: revisionId },
      include: { guide: true, steps: true },
    });
    if (
      !revision ||
      revision.guide.platform !== platform ||
      revision.status !== TutorialRevisionStatus.DRAFT
    ) {
      throw new NotFoundException('Publishable tutorial draft not found');
    }
    if (!revision.steps.length)
      throw new BadRequestException('Cannot publish an empty tutorial');
    const publishedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.tutorialRevision.updateMany({
        where: {
          guideId: revision.guideId,
          status: TutorialRevisionStatus.PUBLISHED,
        },
        data: { status: TutorialRevisionStatus.ARCHIVED },
      });
      await tx.tutorialRevision.update({
        where: { id: revisionId },
        data: { status: TutorialRevisionStatus.PUBLISHED, publishedAt },
      });
      await tx.tutorialGuide.update({
        where: { id: revision.guideId },
        data: { publishedRevisionId: revisionId },
      });
    });
    await this.cache.del(publishedCacheKey);
    return {
      id: revisionId,
      status: 'published',
      publishedAt: publishedAt.toISOString(),
    };
  }

  async uploadImage(file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Select an image to upload');
    if (!allowedImageTypes.has(file.mimetype) || file.size > maxImageBytes) {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP images up to 10 MB are supported',
      );
    }
    const directory = this.imageDirectory();
    await mkdir(directory, { recursive: true });
    const id = randomUUID();
    const storageKey = `${id}.webp`;
    const thumbnailKey = `${id}.thumb.webp`;
    const originalPath = join(directory, storageKey);
    const thumbnailPath = join(directory, thumbnailKey);
    try {
      const image = sharp(file.buffer, { failOn: 'error' }).rotate();
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height)
        throw new BadRequestException('Invalid image');
      await Promise.all([
        image
          .clone()
          .resize({ width: 2000, withoutEnlargement: true })
          .webp({ quality: 88 })
          .toFile(originalPath),
        image
          .clone()
          .resize({ width: 720, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(thumbnailPath),
      ]);
      const output = await sharp(originalPath).metadata();
      const record = await this.prisma.tutorialImage.create({
        data: {
          storageKey,
          originalName: file.originalname.replace(/[\r\n"]/g, ''),
          mimeType: 'image/webp',
          size: file.size,
          width: output.width,
          height: output.height,
        },
      });
      return this.presentImage(record);
    } catch (error) {
      await Promise.all([
        unlink(originalPath).catch(() => undefined),
        unlink(thumbnailPath).catch(() => undefined),
      ]);
      throw error;
    }
  }

  async imagePath(id: string, thumbnail: boolean) {
    const image = await this.prisma.tutorialImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException('Tutorial image not found');
    const key = thumbnail
      ? image.storageKey.replace(/\.webp$/, '.thumb.webp')
      : image.storageKey;
    return join(this.imageDirectory(), key);
  }

  private async ensureDefaults() {
    if (this.defaultsReady) return;
    const legacy = await this.settings.getTutorialConfig();
    const legacyByPlatform = new Map(
      legacy.platforms.map((item) => [item.id, item]),
    );
    for (const [id, item] of Object.entries(defaults) as Array<
      [PlatformId, (typeof defaults)[PlatformId]]
    >) {
      const previous = legacyByPlatform.get(
        id as 'windows' | 'android' | 'ios',
      );
      const guide = await this.prisma.tutorialGuide.upsert({
        where: { platform: item.platform },
        create: {
          platform: item.platform,
          name: item.name,
          meta: previous?.meta ?? item.meta,
          clientName: this.normalizeLegacyCopy(
            previous?.client ?? item.clientName,
          ),
          externalUrl: previous?.externalUrl || null,
        },
        update: {},
        include: { revisions: { take: 1 } },
      });
      if (guide.revisions.length) continue;
      const steps = previous?.steps?.length
        ? previous.steps.map((step) => this.normalizeLegacyCopy(step))
        : this.defaultSteps(item.clientName);
      try {
        const revision = await this.prisma.tutorialRevision.create({
          data: {
            guideId: guide.id,
            version: 1,
            status: TutorialRevisionStatus.PUBLISHED,
            publishedAt: new Date(),
            steps: {
              create: steps.map((text, sortOrder) => ({
                title: text,
                body:
                  sortOrder === 1
                    ? '复制接入页中的 Mihomo YAML 订阅链接，不要分享给其他人。'
                    : `在 ${item.clientName} 中完成此步骤。`,
                sortOrder,
              })),
            },
          },
        });
        await this.prisma.tutorialGuide.update({
          where: { id: guide.id },
          data: { publishedRevisionId: revision.id },
        });
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
        )
          throw error;
      }
    }
    this.defaultsReady = true;
  }

  private defaultSteps(clientName: string) {
    return [
      `安装 ${clientName}`,
      '复制 Mihomo 订阅链接',
      '添加并更新订阅',
      '选择自动节点并启用系统代理',
    ];
  }

  private normalizeLegacyCopy(value: string) {
    return value
      .replaceAll('v2rayN', 'Clash Verge Rev')
      .replaceAll('Hiddify', 'FlClash')
      .replaceAll('sing-box', 'Stash');
  }

  private parsePlatform(value: string) {
    const found = defaults[value as PlatformId];
    if (!found) throw new BadRequestException('Unknown tutorial platform');
    return found.platform;
  }

  private platformId(platform: TutorialPlatform): PlatformId {
    return platform.toLowerCase() as PlatformId;
  }

  private sortGuides<T extends { platform: TutorialPlatform }>(guides: T[]) {
    return [...guides].sort(
      (left, right) =>
        platformOrder[this.platformId(left.platform)] -
        platformOrder[this.platformId(right.platform)],
    );
  }

  private async tutorialAssets() {
    const entries = await Promise.all(
      (['windows', 'android', 'macos'] as const).map(async (platform) => {
        const asset = await this.settings.getTutorialAsset(platform);
        return [
          platform,
          asset
            ? {
                originalName: asset.originalName,
                size: asset.size,
                uploadedAt: asset.uploadedAt,
                downloadUrl: `/api/tutorial-assets/${platform}/download`,
              }
            : null,
        ] as const;
      }),
    );
    return new Map<PlatformId, (typeof entries)[number][1]>(entries);
  }

  private imageDirectory() {
    return (
      process.env.TUTORIAL_IMAGE_DIR ||
      join(process.cwd(), 'storage', 'tutorial-images')
    );
  }

  private presentImage(image: {
    id: string;
    originalName: string;
    width: number | null;
    height: number | null;
  }) {
    return {
      id: image.id,
      originalName: image.originalName,
      width: image.width,
      height: image.height,
      url: `/api/tutorial-images/${image.id}`,
      thumbnailUrl: `/api/tutorial-images/${image.id}?variant=thumbnail`,
    };
  }

  private presentRevision(revision: {
    id: string;
    version: number;
    status: TutorialRevisionStatus;
    publishedAt: Date | null;
    steps: Array<{
      id: string;
      title: string;
      body: string;
      sortOrder: number;
      image: {
        id: string;
        originalName: string;
        width: number | null;
        height: number | null;
      } | null;
    }>;
  }) {
    return {
      id: revision.id,
      version: revision.version,
      status: revision.status.toLowerCase(),
      publishedAt: revision.publishedAt?.toISOString() ?? null,
      steps: revision.steps.map((step) => ({
        id: step.id,
        title: step.title,
        body: step.body,
        sortOrder: step.sortOrder,
        image: step.image ? this.presentImage(step.image) : null,
      })),
    };
  }

  private presentGuide(
    guide: {
      id: string;
      platform: TutorialPlatform;
      name: string;
      meta: string;
      clientName: string;
      externalUrl: string | null;
      active: boolean;
    },
    revision: Parameters<TutorialsService['presentRevision']>[0] | null,
    asset: {
      originalName: string;
      size: number;
      uploadedAt: string;
      downloadUrl: string;
    } | null,
  ) {
    return {
      id: guide.id,
      platform: this.platformId(guide.platform),
      name: guide.name,
      meta: guide.meta,
      clientName: guide.clientName,
      externalUrl: guide.externalUrl,
      active: guide.active,
      asset,
      revision: revision ? this.presentRevision(revision) : null,
    };
  }
}
