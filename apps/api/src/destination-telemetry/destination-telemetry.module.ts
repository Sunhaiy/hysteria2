import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import {
  DestinationAdminController,
  DestinationIngestController,
} from './destination-telemetry.controller';
import { DestinationTelemetryService } from './destination-telemetry.service';

@Module({
  imports: [AuditModule],
  controllers: [DestinationIngestController, DestinationAdminController],
  providers: [DestinationTelemetryService],
  exports: [DestinationTelemetryService],
})
export class DestinationTelemetryModule {}
