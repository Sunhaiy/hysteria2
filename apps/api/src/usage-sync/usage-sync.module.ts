import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { KickServiceModule } from '../kick-service/kick-service.module';
import { UsageSyncService } from './usage-sync.service';

@Module({
  imports: [IntegrationsModule, KickServiceModule],
  providers: [UsageSyncService],
  exports: [UsageSyncService],
})
export class UsageSyncModule {}
