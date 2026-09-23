import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PortalService } from './portal.service';
import { webPublicUrl } from '../common/public-url';

function profileHeaders(
  profile: string | undefined,
  title: string,
  filename: string,
) {
  const name = profile === '2' ? '素心 Network' : title;
  return {
    'Content-Disposition':
      profile === '2'
        ? `inline; filename*=UTF-8''${encodeURIComponent(name)}`
        : `inline; filename="${filename}"`,
    'Profile-Title': `base64:${Buffer.from(name, 'utf8').toString('base64')}`,
    'Profile-Web-Page-Url': `${webPublicUrl()}/login`,
  };
}

@Controller('subscribe')
export class SubscriptionFeedController {
  constructor(private readonly portalService: PortalService) {}

  @Get(':token')
  async getSubscription(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
    @Query('profile') profile?: string,
  ) {
    const feed = await this.portalService.getClientSubscription(token);
    const expiresAt = Math.floor(feed.expiresAt / 1000);

    response.type('text/plain');
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      ...profileHeaders(profile, feed.title, 'subscription.txt'),
      'Profile-Update-Interval': '12',
      'Subscription-Userinfo': `upload=0; download=${feed.consumedBytes}; total=${feed.totalBytes}; expire=${expiresAt}`,
      'X-Subscription-Node-Count': String(feed.nodeCount),
    });
    return feed.content;
  }

  @Get(':token/clash')
  async getMihomoSubscription(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
    @Query('profile') profile?: string,
    @Query('mode') mode?: string,
  ) {
    if (mode && !['inline', 'provider'].includes(mode))
      throw new BadRequestException('订阅模式无效');
    const feed = await this.portalService.getMihomoSubscription(
      token,
      mode === 'inline' ? 'inline' : 'provider',
    );
    const expiresAt = Math.floor(feed.expiresAt / 1000);

    response.set({
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      ...profileHeaders(profile, feed.title, 'mihomo.yaml'),
      'Profile-Update-Interval': '12',
      'Subscription-Userinfo': `upload=0; download=${feed.consumedBytes}; total=${feed.totalBytes}; expire=${expiresAt}`,
      'X-Subscription-Node-Count': String(feed.nodeCount),
      'X-Content-Type-Options': 'nosniff',
    });
    return feed.content;
  }

  @Get(':token/clash/nodes')
  async getMihomoProvider(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
    @Query('scope') scope?: string,
  ) {
    response.set({
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });
    if (scope && !['all', 'ai'].includes(scope))
      throw new BadRequestException('节点分组无效');
    return this.portalService.getMihomoProvider(
      token,
      scope === 'ai' ? 'ai' : 'all',
    );
  }
}
