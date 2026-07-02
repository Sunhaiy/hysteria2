import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { SubscriptionFeedController } from './subscription-feed.controller';

@Module({
  controllers: [PortalController, SubscriptionFeedController],
  providers: [PortalService],
  exports: [PortalService],
})
export class PortalModule {}
