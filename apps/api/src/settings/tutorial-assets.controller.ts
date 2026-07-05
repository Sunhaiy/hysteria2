import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  SettingsService,
  type TutorialUploadPlatform,
} from './settings.service';

const MAX_APP_SIZE = 250 * 1024 * 1024;
const allowedExtensions: Record<TutorialUploadPlatform, Set<string>> = {
  windows: new Set(['.exe', '.msi', '.zip']),
  android: new Set(['.apk']),
};

function assetDirectory() {
  return (
    process.env.TUTORIAL_ASSET_DIR ||
    join(process.cwd(), 'storage', 'tutorial-assets')
  );
}

function parsePlatform(value: string): TutorialUploadPlatform {
  if (value !== 'windows' && value !== 'android') {
    throw new BadRequestException('仅支持上传 Windows 或 Android 客户端。');
  }
  return value;
}

function safeAssetPath(storedName: string) {
  if (basename(storedName) !== storedName) {
    throw new BadRequestException('无效的客户端文件记录。');
  }
  return join(assetDirectory(), storedName);
}

const uploadStorage = diskStorage({
  destination: (_request, _file, callback) => {
    const directory = assetDirectory();
    mkdirSync(directory, { recursive: true });
    callback(null, directory);
  },
  filename: (_request, file, callback) => {
    callback(
      null,
      `${Date.now()}-${randomUUID()}${extname(file.originalname).toLowerCase()}`,
    );
  },
});

@Controller('api/admin/tutorial-assets')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTutorialAssetsController {
  constructor(private readonly settings: SettingsService) {}

  @Post(':platform')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: MAX_APP_SIZE, files: 1 },
    }),
  )
  async upload(
    @Param('platform') platformValue: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('请选择要上传的客户端安装包。');
    let platform: TutorialUploadPlatform;
    try {
      platform = parsePlatform(platformValue);
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }

    const extension = extname(file.originalname).toLowerCase();
    if (!allowedExtensions[platform].has(extension)) {
      await unlink(file.path).catch(() => undefined);
      const expected = platform === 'windows' ? 'EXE、MSI 或 ZIP' : 'APK';
      throw new BadRequestException(
        `文件格式不正确，${platform === 'windows' ? 'Windows' : 'Android'} 仅支持 ${expected}。`,
      );
    }

    const previous = await this.settings.getTutorialAsset(platform);
    const asset = {
      storedName: file.filename,
      originalName: basename(file.originalname.replaceAll('\\', '/')).replace(
        /[\r\n"]/g,
        '',
      ),
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };

    try {
      await this.settings.saveTutorialAsset(platform, asset);
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }

    if (previous && previous.storedName !== asset.storedName) {
      await unlink(safeAssetPath(previous.storedName)).catch(() => undefined);
    }

    return this.settings.getTutorialConfig();
  }
}

@Controller('api/tutorial-assets')
export class PublicTutorialAssetsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getTutorial() {
    return this.settings.getTutorialConfig();
  }

  @Get(':platform/download')
  async download(
    @Param('platform') platformValue: string,
    @Res() response: Response,
  ) {
    const platform = parsePlatform(platformValue);
    const asset = await this.settings.getTutorialAsset(platform);
    if (!asset) throw new NotFoundException('该平台暂未上传客户端。');

    const path = safeAssetPath(asset.storedName);
    if (!existsSync(path))
      throw new NotFoundException('客户端文件不存在，请联系管理员重新上传。');
    response.download(path, asset.originalName);
  }
}
