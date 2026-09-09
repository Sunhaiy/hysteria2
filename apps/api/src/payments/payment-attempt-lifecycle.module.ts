import { Module } from '@nestjs/common';
import { PaymentAttemptLifecycleService } from './payment-attempt-lifecycle.service';

@Module({
  providers: [PaymentAttemptLifecycleService],
  exports: [PaymentAttemptLifecycleService],
})
export class PaymentAttemptLifecycleModule {}
