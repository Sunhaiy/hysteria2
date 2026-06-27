import { Global, Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller';
import { PublicSiteController } from './public-site.controller';
import { SettingsService } from './settings.service';

@Global()
@Module({
  controllers: [AdminSettingsController, PublicSiteController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
