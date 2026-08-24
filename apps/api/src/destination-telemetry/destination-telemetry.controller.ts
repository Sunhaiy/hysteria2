import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { DestinationBatchDto } from './destination-telemetry.dto';
import { DestinationTelemetryService } from './destination-telemetry.service';

@Controller('integrations/nodes')
export class DestinationIngestController {
  constructor(private readonly telemetry: DestinationTelemetryService) {}

  @Post(':nodeId/destination-batches')
  ingest(
    @Param('nodeId') nodeId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: DestinationBatchDto,
  ) {
    return this.telemetry.ingest(nodeId, authorization, body);
  }
}

@Controller('api/admin/destination-visits')
@UseGuards(JwtAuthGuard, AdminGuard)
export class DestinationAdminController {
  constructor(private readonly telemetry: DestinationTelemetryService) {}

  @Get('status')
  status() {
    return this.telemetry.status();
  }

  @Get()
  query(
    @Query() query: Record<string, string | undefined>,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.telemetry.query(query, principal.sub);
  }
}
