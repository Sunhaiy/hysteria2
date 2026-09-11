import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AnnouncementImagesService } from './announcement-images.service';

@Controller('api/admin/settings/announcement/images')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAnnouncementImagesController {
  constructor(private readonly images: AnnouncementImagesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.images.upload(file);
  }
}

@Controller('api/announcement-images')
export class PublicAnnouncementImagesController {
  constructor(private readonly images: AnnouncementImagesService) {}

  @Get(':id')
  async image(@Param('id') id: string, @Res() response: Response) {
    const image = await this.images.asset(id);
    if (response.req.headers['if-none-match'] === image.etag) {
      response.status(304).end();
      return;
    }
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('ETag', image.etag);
    response.type('image/webp').sendFile(image.path);
  }
}
