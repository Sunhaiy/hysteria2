import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { SubscriptionFeedController } from './subscription-feed.controller';

@Module({
  imports: [CommerceModule, EntitlementModule],
  controllers: [PortalController, SubscriptionFeedController],
  providers: [PortalService],
  exports: [PortalService],
})
export class PortalModule {}
