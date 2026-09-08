import { Module } from '@nestjs/common';
import {
  AdminCheckInController,
  PortalCheckInController,
} from './check-in.controller';
import { CheckInService } from './check-in.service';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [EntitlementModule],
  controllers: [PortalCheckInController, AdminCheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}
