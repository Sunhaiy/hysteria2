import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { EpayCheckoutService } from './epay-checkout.service';
import { EpayController } from './epay.controller';
import { EpayReconciliationService } from './epay-reconciliation.service';
import { EpayService } from './epay.service';

@Module({
  imports: [CommerceModule],
  controllers: [EpayController],
  providers: [EpayService, EpayCheckoutService, EpayReconciliationService],
  exports: [EpayService, EpayReconciliationService],
})
export class EpayModule {}
