import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { GroupBuyModule } from '../group-buy/group-buy.module';
import { EpayCheckoutService } from './epay-checkout.service';
import { EpayController } from './epay.controller';
import { EpayReconciliationService } from './epay-reconciliation.service';
import { EpayService } from './epay.service';
import { PaymentAttemptLifecycleModule } from '../payments/payment-attempt-lifecycle.module';

@Module({
  imports: [CommerceModule, GroupBuyModule, PaymentAttemptLifecycleModule],
  controllers: [EpayController],
  providers: [EpayService, EpayCheckoutService, EpayReconciliationService],
  exports: [EpayService, EpayReconciliationService],
})
export class EpayModule {}
