import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MonitoringController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get('usage')
  getUsage() {
    return this.store.getUsageRollups();
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
