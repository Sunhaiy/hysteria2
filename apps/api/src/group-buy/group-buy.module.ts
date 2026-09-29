import { Module } from '@nestjs/common';
import { HolidayModule } from '../holiday/holiday.module';
import { CommerceModule } from '../commerce/commerce.module';
import {
  AdminGroupBuyController,
  PortalGroupBuyController,
} from './group-buy.controller';
import { GroupBuyService } from './group-buy.service';
import { GroupBuyReconciliationService } from './group-buy-reconciliation.service';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { PaymentAttemptLifecycleModule } from '../payments/payment-attempt-lifecycle.module';

@Module({
  imports: [
    CommerceModule,
    EntitlementModule,
    PaymentAttemptLifecycleModule,
    HolidayModule,
  ],
  controllers: [PortalGroupBuyController, AdminGroupBuyController],
  providers: [GroupBuyService, GroupBuyReconciliationService],
  exports: [GroupBuyService, GroupBuyReconciliationService],
})
export class GroupBuyModule {}
