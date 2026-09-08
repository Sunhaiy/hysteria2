import { Module } from '@nestjs/common';
import { MemberOnboardingService } from './member-onboarding.service';
import { ReferralService } from './referral.service';
import {
  AdminReferralController,
  PortalReferralController,
} from './referral.controller';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [EntitlementModule],
  controllers: [PortalReferralController, AdminReferralController],
  providers: [ReferralService, MemberOnboardingService],
  exports: [ReferralService, MemberOnboardingService],
})
export class ReferralModule {}
