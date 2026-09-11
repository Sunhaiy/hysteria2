import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminPermission } from '@prisma/client';
import type { Response } from 'express';
import { AdminPermissionGuard } from '../common/admin-permission.guard';
import { RequireAdminPermission } from '../common/admin-permission.decorator';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  CreateSeoKeywordDto,
  GenerateSeoArticleDto,
  SaveSeoArticleDto,
  ScheduleSeoArticleDto,
  SeoListQueryDto,
  UpdateSeoKeywordDto,
  UpdateSeoSettingsDto,
} from './seo-publishing.dto';
import { SeoPublishingService } from './seo-publishing.service';

@Controller('api/admin/seo')
@UseGuards(JwtAuthGuard, AdminGuard, AdminPermissionGuard)
@RequireAdminPermission(AdminPermission.SEO_CONTENT_MANAGE)
export class AdminSeoPublishingController {
  constructor(private readonly seo: SeoPublishingService) {}

  @Get('settings')
  settings() {
    return this.seo.getAdminSettings();
  }

  @Put('settings')
  updateSettings(@Body() body: UpdateSeoSettingsDto) {
    return this.seo.updateAdminSettings(body);
  }

  @Post('settings/test-ai')
  testAi() {
    return this.seo.testAiConnection();
  }

  @Post('settings/test-google')
  testGoogle() {
    return this.seo.testGoogleConnection();
  }

  @Get('keywords')
  keywords(@Query() query: SeoListQueryDto) {
    return this.seo.listKeywords(query);
  }

  @Post('keywords')
  createKeyword(@Body() body: CreateSeoKeywordDto) {
    return this.seo.createKeyword(body);
  }

  @Patch('keywords/:id')
  updateKeyword(@Param('id') id: string, @Body() body: UpdateSeoKeywordDto) {
    return this.seo.updateKeyword(id, body);
  }

  @Get('articles')
  articles(@Query() query: SeoListQueryDto) {
    return this.seo.listAdminArticles(query);
  }

  @Get('articles/:id')
  article(@Param('id') id: string) {
    return this.seo.getAdminArticle(id);
  }

  @Post('articles')
  createArticle(
    @Body() body: SaveSeoArticleDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.seo.createArticle(body, principal.sub);
  }

  @Put('articles/:id')
  saveArticle(
    @Param('id') id: string,
    @Body() body: SaveSeoArticleDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.seo.saveArticle(id, body, principal.sub);
  }

  @Post('articles/:id/publish')
  publishArticle(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.seo.publishArticle(id, principal.sub);
  }

  @Post('articles/:id/schedule')
  scheduleArticle(
    @Param('id') id: string,
    @Body() body: ScheduleSeoArticleDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.seo.scheduleArticle(
      id,
      new Date(body.scheduledAt),
      principal.sub,
    );
  }

  @Post('articles/:id/archive')
  archiveArticle(@Param('id') id: string) {
    return this.seo.archiveArticle(id);
  }

  @Post('articles/:articleId/revisions/:revisionId/restore')
  restoreRevision(
    @Param('articleId') articleId: string,
    @Param('revisionId') revisionId: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.seo.restoreRevision(articleId, revisionId, principal.sub);
  }

  @Post('articles/:id/cover/regenerate')
  regenerateCover(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.seo.regenerateCover(id, principal.sub);
  }

  @Post('generate')
  queueGeneration(
    @Body() body: GenerateSeoArticleDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.seo.queueGeneration(body.keywordId, principal.sub);
  }

  @Post('generation-jobs/:id/retry')
  retryGeneration(@Param('id') id: string) {
    return this.seo.retryGeneration(id);
  }

  @Post('index-submissions/:id/retry')
  retryIndex(@Param('id') id: string) {
    return this.seo.retryIndexSubmission(id);
  }

  @Get('jobs')
  jobs() {
    return this.seo.listJobs();
  }

  @Get('analytics')
  analytics() {
    return this.seo.analytics();
  }

  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    return this.seo.uploadImage(file);
  }
}

@Controller('api/seo')
export class PublicSeoPublishingController {
  constructor(private readonly seo: SeoPublishingService) {}

  @Get('articles')
  articles(@Query() query: SeoListQueryDto) {
    return this.seo.listPublishedArticles(query);
  }

  @Get('articles/sitemap')
  sitemap() {
    return this.seo.sitemapEntries();
  }

  @Get('articles/:slug')
  article(@Param('slug') slug: string) {
    return this.seo.getPublishedArticle(slug);
  }

  @Get('redirects/:slug')
  redirect(@Param('slug') slug: string) {
    return this.seo.resolvePublishedRedirect(slug);
  }

  @Get('indexnow-key')
  async indexNowKey(@Res() response: Response) {
    response.type('text/plain').send(await this.seo.indexNowKey());
  }

  @Get('images/:id')
  async image(@Param('id') id: string, @Res() response: Response) {
    const image = await this.seo.imageAsset(id);
    if (response.req.headers['if-none-match'] === image.etag) {
      response.status(304).end();
      return;
    }
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('ETag', image.etag);
    response.type(image.mimeType).sendFile(image.path, { dotfiles: 'allow' });
  }
}
