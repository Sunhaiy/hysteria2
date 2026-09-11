import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AnnouncementImagesService } from './announcement-images.service';

describe('AnnouncementImagesService', () => {
  let directory: string;
  let previousDirectory: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'announcement-images-'));
    previousDirectory = process.env.ANNOUNCEMENT_IMAGE_DIR;
    process.env.ANNOUNCEMENT_IMAGE_DIR = directory;
  });

  afterEach(async () => {
    if (previousDirectory === undefined) {
      delete process.env.ANNOUNCEMENT_IMAGE_DIR;
    } else {
      process.env.ANNOUNCEMENT_IMAGE_DIR = previousDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  });

  it('normalizes uploaded images to a persistent WebP asset', async () => {
    const source = await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: '#2fbf71',
      },
    })
      .png()
      .toBuffer();
    const service = new AnnouncementImagesService();
    const uploaded = await service.upload({
      buffer: source,
      mimetype: 'image/png',
      size: source.length,
      originalname: 'notice.png',
    } as Express.Multer.File);

    expect(uploaded.url).toContain(`/api/announcement-images/${uploaded.id}`);
    expect(uploaded).toMatchObject({ width: 64, height: 32 });
    const asset = await service.asset(uploaded.id);
    await expect(access(asset.path)).resolves.toBeUndefined();
    await expect(
      sharp(await readFile(asset.path)).metadata(),
    ).resolves.toMatchObject({
      format: 'webp',
    });
  });

  it('rejects unsupported uploads and invalid asset ids', async () => {
    const service = new AnnouncementImagesService();
    await expect(
      service.upload({
        buffer: Buffer.from('image'),
        mimetype: 'image/svg+xml',
        size: 5,
      } as Express.Multer.File),
    ).rejects.toThrow('仅支持 JPEG、PNG 或 WebP 图片');
    await expect(service.asset('../secret')).rejects.toThrow('图片不存在');
  });
});
