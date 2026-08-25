import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { SaveTutorialDraftDto } from './tutorials.dto';
import { TutorialsService } from './tutorials.service';

@Controller('api/admin/tutorials')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTutorialsController {
  constructor(private readonly tutorials: TutorialsService) {}

  @Get()
  overview() {
    return this.tutorials.adminOverview();
  }

  @Post(':platform/drafts')
  createDraft(@Param('platform') platform: string) {
    return this.tutorials.createDraft(platform);
  }

  @Put(':platform/drafts/:revisionId')
  saveDraft(
    @Param('platform') platform: string,
    @Param('revisionId') revisionId: string,
    @Body() body: SaveTutorialDraftDto,
  ) {
    return this.tutorials.saveDraft(platform, revisionId, body);
  }

  @Post(':platform/drafts/:revisionId/publish')
  publish(
    @Param('platform') platform: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.tutorials.publish(platform, revisionId);
  }

  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    return this.tutorials.uploadImage(file);
  }
}

@Controller('api/tutorials')
export class PublicTutorialsController {
  constructor(private readonly tutorials: TutorialsService) {}

  @Get()
  published() {
    return this.tutorials.published();
  }
}

@Controller('api/tutorial-images')
export class TutorialImagesController {
  constructor(private readonly tutorials: TutorialsService) {}

  @Get(':id')
  async image(
    @Param('id') id: string,
    @Query('variant') variant: string | undefined,
    @Res() response: Response,
  ) {
    response.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    response.type('image/webp');
    response.sendFile(
      await this.tutorials.imagePath(id, variant === 'thumbnail'),
    );
  }
}
