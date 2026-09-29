import { Global, Module } from '@nestjs/common';
import { SubscriptionNoticesController } from './subscription-notices.controller';
import { SubscriptionNoticesService } from './subscription-notices.service';
import { AdminSettingsController } from './admin-settings.controller';
import { PublicSiteController } from './public-site.controller';
import { SettingsService } from './settings.service';
import {
  AdminTutorialAssetsController,
  PublicTutorialAssetsController,
} from './tutorial-assets.controller';
import {
  AdminAnnouncementImagesController,
  PublicAnnouncementImagesController,
} from './announcement-images.controller';
import { AnnouncementImagesService } from './announcement-images.service';

@Global()
@Module({
  controllers: [
    SubscriptionNoticesController,
    AdminSettingsController,
    PublicSiteController,
    AdminTutorialAssetsController,
    PublicTutorialAssetsController,
    AdminAnnouncementImagesController,
    PublicAnnouncementImagesController,
  ],
  providers: [
    SettingsService,
    AnnouncementImagesService,
    SubscriptionNoticesService,
  ],
  exports: [SettingsService, SubscriptionNoticesService],
})
export class SettingsModule {}
