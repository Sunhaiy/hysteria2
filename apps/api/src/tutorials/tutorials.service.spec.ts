import { TutorialPlatform, TutorialRevisionStatus } from '@prisma/client';
import { TutorialsService } from './tutorials.service';

describe('TutorialsService', () => {
  it('presents the Android guide as a Clash Meta import tutorial', async () => {
    const androidGuide = {
      id: 'guide_android',
      platform: TutorialPlatform.ANDROID,
      name: 'Android',
      meta: '手机 / 平板',
      clientName: 'FlClash',
      externalUrl: null,
      active: true,
      publishedRevisionId: 'revision_android',
      publishedRevision: {
        id: 'revision_android',
        version: 1,
        status: TutorialRevisionStatus.PUBLISHED,
        publishedAt: new Date('2026-08-25T00:00:00.000Z'),
        steps: [
          {
            id: 'step_android',
            title: '在 FlClash 中导入订阅',
            body: '打开 FlClash 后粘贴订阅链接。',
            sortOrder: 0,
            image: null,
          },
        ],
      },
    };
    const prisma = {
      tutorialGuide: { findMany: jest.fn().mockResolvedValue([androidGuide]) },
    };
    const settings = {
      getTutorialAsset: jest.fn().mockResolvedValue(null),
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TutorialsService(
      prisma as never,
      settings as never,
      cache as never,
    );
    (service as unknown as { defaultsReady: boolean }).defaultsReady = true;

    await expect(service.published()).resolves.toMatchObject({
      platforms: [
        {
          clientName: 'Clash Meta',
          revision: {
            steps: [
              {
                title: '在 Clash Meta 中导入订阅',
                body: '打开 Clash Meta 后粘贴订阅链接。',
              },
            ],
          },
        },
      ],
    });
  });

  it('publishes a draft atomically and invalidates the published guide cache', async () => {
    const revision = {
      id: 'revision_2',
      guideId: 'guide_windows',
      status: TutorialRevisionStatus.DRAFT,
      guide: { platform: TutorialPlatform.WINDOWS },
      steps: [{ id: 'step_1' }],
    };
    const tx = {
      tutorialRevision: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      tutorialGuide: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      tutorialRevision: { findUnique: jest.fn().mockResolvedValue(revision) },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const cache = { del: jest.fn().mockResolvedValue(undefined) };
    const service = new TutorialsService(
      prisma as never,
      {} as never,
      cache as never,
    );

    await expect(
      service.publish('windows', 'revision_2'),
    ).resolves.toMatchObject({ id: 'revision_2', status: 'published' });

    expect(tx.tutorialRevision.updateMany).toHaveBeenCalledWith({
      where: {
        guideId: 'guide_windows',
        status: TutorialRevisionStatus.PUBLISHED,
      },
      data: { status: TutorialRevisionStatus.ARCHIVED },
    });
    const [publishUpdate] = tx.tutorialRevision.update.mock
      .calls[0] as unknown as [
      { where: { id: string }; data: { status: string; publishedAt: Date } },
    ];
    expect(publishUpdate).toMatchObject({
      where: { id: 'revision_2' },
      data: { status: TutorialRevisionStatus.PUBLISHED },
    });
    expect(publishUpdate.data.publishedAt).toBeInstanceOf(Date);
    expect(tx.tutorialGuide.update).toHaveBeenCalledWith({
      where: { id: 'guide_windows' },
      data: { publishedRevisionId: 'revision_2' },
    });
    expect(cache.del).toHaveBeenCalledWith('tutorials:published:v2');
  });

  it('rejects unsupported image content before touching storage or the database', async () => {
    const prisma = { tutorialImage: { create: jest.fn() } };
    const service = new TutorialsService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.uploadImage({
        mimetype: 'image/svg+xml',
        size: 100,
        originalname: 'unsafe.svg',
        buffer: Buffer.from('<svg/>'),
      } as Express.Multer.File),
    ).rejects.toThrow(
      'Only JPEG, PNG or WebP images up to 10 MB are supported',
    );
    expect(prisma.tutorialImage.create).not.toHaveBeenCalled();
  });
});
