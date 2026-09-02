import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { ReferralModule } from '../referrals/referral.module';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [ReferralModule, EntitlementModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
