import { Module } from '@nestjs/common';
import { AdminPermissionGuard } from '../common/admin-permission.guard';
import {
  AdminSeoPublishingController,
  PublicSeoPublishingController,
} from './seo-publishing.controller';
import { SeoAiAdapter } from './seo-ai.adapter';
import { SeoPublishingService } from './seo-publishing.service';
import { SeoSearchAdapter } from './seo-search.adapter';

@Module({
  controllers: [AdminSeoPublishingController, PublicSeoPublishingController],
  providers: [
    AdminPermissionGuard,
    SeoAiAdapter,
    SeoSearchAdapter,
    SeoPublishingService,
  ],
  exports: [SeoPublishingService],
})
export class SeoPublishingModule {}
