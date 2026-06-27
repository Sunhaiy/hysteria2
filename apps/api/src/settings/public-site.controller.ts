import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

// Public, unauthenticated: the login page needs the site name before a session
// exists.
@Controller('api/site')
export class PublicSiteController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getSite() {
    return this.settings.getSiteInfo();
  }
}
