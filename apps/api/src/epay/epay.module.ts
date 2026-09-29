import { Module } from '@nestjs/common';
import { HolidayModule } from '../holiday/holiday.module';
import { HolidayController } from '../holiday/holiday.controller';
import { CommerceModule } from '../commerce/commerce.module';
import { GroupBuyModule } from '../group-buy/group-buy.module';
import { EpayCheckoutService } from './epay-checkout.service';
import { EpayController } from './epay.controller';
import { EpayReconciliationService } from './epay-reconciliation.service';
import { EpayService } from './epay.service';
import { PaymentAttemptLifecycleModule } from '../payments/payment-attempt-lifecycle.module';

@Module({
  imports: [
    CommerceModule,
    GroupBuyModule,
    PaymentAttemptLifecycleModule,
    HolidayModule,
  ],
  controllers: [EpayController, HolidayController],
  providers: [EpayService, EpayCheckoutService, EpayReconciliationService],
  exports: [EpayService, EpayReconciliationService],
})
export class EpayModule {}
