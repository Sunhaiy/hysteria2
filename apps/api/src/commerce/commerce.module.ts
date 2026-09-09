import { Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { ReferralModule } from '../referrals/referral.module';
import { PaymentAttemptLifecycleModule } from '../payments/payment-attempt-lifecycle.module';

@Module({
  imports: [EntitlementModule, ReferralModule, PaymentAttemptLifecycleModule],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}
