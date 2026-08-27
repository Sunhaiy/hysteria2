import { Module } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { ReferralModule } from '../referrals/referral.module';

@Module({
  imports: [EntitlementModule, ReferralModule],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}
