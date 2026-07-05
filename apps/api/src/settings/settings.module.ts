import { Global, Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller';
import { PublicSiteController } from './public-site.controller';
import { SettingsService } from './settings.service';
import {
  AdminTutorialAssetsController,
  PublicTutorialAssetsController,
} from './tutorial-assets.controller';

@Global()
@Module({
  controllers: [
    AdminSettingsController,
    PublicSiteController,
    AdminTutorialAssetsController,
    PublicTutorialAssetsController,
  ],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
