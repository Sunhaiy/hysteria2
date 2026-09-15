import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { KickService } from './kick-service.service';
import { QuotaEnforcementService } from './quota-enforcement.service';
import { EntitlementModule } from '../entitlement/entitlement.module';

@Module({
  imports: [IntegrationsModule, EntitlementModule],
  providers: [KickService, QuotaEnforcementService],
  exports: [KickService, QuotaEnforcementService],
})
export class KickServiceModule {}
