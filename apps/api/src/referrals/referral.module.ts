import { Module } from '@nestjs/common';
import { MemberOnboardingService } from './member-onboarding.service';
import { ReferralService } from './referral.service';
import {
  AdminReferralController,
  PortalReferralController,
} from './referral.controller';

@Module({
  controllers: [PortalReferralController, AdminReferralController],
  providers: [ReferralService, MemberOnboardingService],
  exports: [ReferralService, MemberOnboardingService],
})
export class ReferralModule {}
