import { Module } from '@nestjs/common';
import { TrafficAnalyticsController } from './traffic-analytics.controller';
import { TrafficAnalyticsService } from './traffic-analytics.service';
import { ReportSnapshotService } from './report-snapshot.service';

@Module({
  controllers: [TrafficAnalyticsController],
  providers: [TrafficAnalyticsService, ReportSnapshotService],
  exports: [TrafficAnalyticsService, ReportSnapshotService],
})
export class TrafficAnalyticsModule {}
