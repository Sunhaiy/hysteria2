import {
  Controller,
  Get,
  HttpCode,
  Post,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { TrafficQuery } from '../traffic-analytics/traffic-analytics.service';
import {
  OperationsService,
  type AlertQuery,
  type PresenceQuery,
} from './operations.service';

@Controller('api/admin/operations')
@UseGuards(JwtAuthGuard, AdminGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('summary')
  summary() {
    return this.operations.summary();
  }

  @Get('presence')
  presence(@Query() query: PresenceQuery) {
    return this.operations.presence(query);
  }

  @Get('traffic/overview')
  trafficOverview(@Query() query: TrafficQuery) {
    return this.operations.trafficOverview(query);
  }

  @Get('traffic/details')
  trafficDetails(@Query() query: TrafficQuery) {
    return this.operations.trafficDetails(query);
  }

  @Get('alerts')
  alerts(@Query() query: AlertQuery) {
    return this.operations.alerts(query);
  }

  @Post('presence/:userId/kick')
  kickUser(
    @Param('userId') userId: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.operations.kickUser(userId, principal.email);
  }

  @Patch('alerts/:id/acknowledge')
  acknowledgeAlert(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.operations.acknowledgeAlert(id, principal.sub);
  }

  @Post('checks')
  @HttpCode(202)
  requestCheck() {
    return this.operations.requestCheck();
  }
}
