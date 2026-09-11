import { Global, Module } from '@nestjs/common';
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
    AdminSettingsController,
    PublicSiteController,
    AdminTutorialAssetsController,
    PublicTutorialAssetsController,
    AdminAnnouncementImagesController,
    PublicAnnouncementImagesController,
  ],
  providers: [SettingsService, AnnouncementImagesService],
  exports: [SettingsService],
})
export class SettingsModule {}
