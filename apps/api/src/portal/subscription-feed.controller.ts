import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PortalService } from './portal.service';

@Controller('subscribe')
export class SubscriptionFeedController {
  constructor(private readonly portalService: PortalService) {}

  @Get(':token')
  async getSubscription(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const feed = await this.portalService.getClientSubscription(token);
    const title = Buffer.from(feed.title, 'utf8').toString('base64');
    const expiresAt = Math.floor(feed.expiresAt / 1000);

    response.type('text/plain');
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': 'inline; filename="subscription.txt"',
      'Profile-Title': `base64:${title}`,
      'Profile-Update-Interval': '12',
      'Subscription-Userinfo': `upload=0; download=${feed.consumedBytes}; total=${feed.totalBytes}; expire=${expiresAt}`,
      'X-Subscription-Node-Count': String(feed.nodeCount),
    });
    return feed.content;
  }
}
