import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { TrafficAnalyticsModule } from '../traffic-analytics/traffic-analytics.module';
import { KickServiceModule } from '../kick-service/kick-service.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [
    IntegrationsModule,
    MonitoringModule,
    TrafficAnalyticsModule,
    KickServiceModule,
  ],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
