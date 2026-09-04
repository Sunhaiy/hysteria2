import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { SubscriptionFeedController } from './subscription-feed.controller';
import { AnniversaryGiftService } from './anniversary-gift.service';

@Module({
  imports: [CommerceModule, EntitlementModule],
  controllers: [PortalController, SubscriptionFeedController],
  providers: [PortalService, AnniversaryGiftService],
  exports: [PortalService],
})
export class PortalModule {}
