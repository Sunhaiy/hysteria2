import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { KickServiceModule } from '../kick-service/kick-service.module';
import { UsageSyncService } from './usage-sync.service';
import { CacheModule } from '../cache/cache.module';
import { NodeSyncRequestService } from './node-sync-request.service';

@Module({
  imports: [
    CacheModule,
    IntegrationsModule,
    KickServiceModule,
    EntitlementModule,
  ],
  providers: [UsageSyncService, NodeSyncRequestService],
  exports: [UsageSyncService, NodeSyncRequestService],
})
export class UsageSyncModule {}
