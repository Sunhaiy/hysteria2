import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { HysteriaAuthController } from './hysteria-auth.controller';
import { HysteriaAuthService } from './hysteria-auth.service';
import { HysteriaAuthTelemetryService } from './hysteria-auth-telemetry.service';

@Module({
  imports: [EntitlementModule],
  controllers: [HysteriaAuthController],
  providers: [HysteriaAuthService, HysteriaAuthTelemetryService],
})
export class HysteriaAuthModule {}
