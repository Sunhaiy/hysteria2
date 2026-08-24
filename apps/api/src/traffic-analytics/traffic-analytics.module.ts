import { Module } from '@nestjs/common';
import { TrafficAnalyticsController } from './traffic-analytics.controller';
import { TrafficAnalyticsService } from './traffic-analytics.service';

@Module({
  controllers: [TrafficAnalyticsController],
  providers: [TrafficAnalyticsService],
})
export class TrafficAnalyticsModule {}
