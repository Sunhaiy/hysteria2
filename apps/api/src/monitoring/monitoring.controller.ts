import { Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { MonitoringService } from './monitoring.service';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';

@Controller('api/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MonitoringController {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly monitoring: MonitoringService,
  ) {}

  @Get('monitoring')
  getMonitoring() {
    return this.monitoring.overview();
  }

  @Post('monitoring/check')
  runMonitoringCheck() {
    return this.monitoring.runChecks();
  }

  @Patch('monitoring/alerts/:id/acknowledge')
  acknowledgeAlert(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.monitoring.acknowledge(id, principal.sub);
  }

  @Get('usage')
  getUsage() {
    return this.store.getUsageRollups();
  }

  @Get('usage/summary')
  getUsageSummary() {
    return this.store.getUsageSummary();
  }

  @Get('sessions')
  getSessions() {
    return this.store.getCurrentSessions();
  }

  @Get('auth-events')
  getAuthEvents() {
    return this.store.getAuthEvents();
  }
}
