import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { KickService } from './kick-service.service';

@Module({
  imports: [IntegrationsModule],
  providers: [KickService],
  exports: [KickService],
})
export class KickServiceModule {}
