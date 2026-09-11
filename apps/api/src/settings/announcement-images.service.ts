import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { apiPublicUrl } from '../common/public-url';

const maxImageBytes = 10 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const imageIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function announcementImageDirectory() {
  return resolve(
    process.env.ANNOUNCEMENT_IMAGE_DIR ??
      join(process.cwd(), 'storage', 'announcement-images'),
  );
}

@Injectable()
export class AnnouncementImagesService {
  async upload(file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('请选择图片');
    if (!allowedImageTypes.has(file.mimetype)) {
      throw new BadRequestException('仅支持 JPEG、PNG 或 WebP 图片');
    }
    if (file.size > maxImageBytes) {
      throw new BadRequestException('图片不能超过 10 MB');
    }

    const directory = announcementImageDirectory();
    await mkdir(directory, { recursive: true });
    const id = randomUUID();
    const path = join(directory, `${id}.webp`);
    try {
      const image = sharp(file.buffer, { failOn: 'error' }).rotate();
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) {
        throw new BadRequestException('图片文件无效');
      }
      const output = await image
        .resize({
          width: 1800,
          height: 1800,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 88 })
        .toFile(path);
      return {
        id,
        width: output.width,
        height: output.height,
        url: `${apiPublicUrl()}/api/announcement-images/${id}`,
      };
    } catch (error) {
      await unlink(path).catch(() => undefined);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('图片无法读取，请更换后重试');
    }
  }

  async asset(id: string) {
    if (!imageIdPattern.test(id)) throw new NotFoundException('图片不存在');
    const path = join(announcementImageDirectory(), `${id}.webp`);
    await access(path).catch(() => {
      throw new NotFoundException('图片不存在');
    });
    return { path, etag: `"announcement-${id}"` };
  }
}
