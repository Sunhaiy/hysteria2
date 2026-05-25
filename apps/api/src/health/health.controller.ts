import { Controller, Get } from '@nestjs/common';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/health')
export class HealthController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  async getHealth() {
    return {
      ok: true,
      timestamp: new Date().toISOString(),
      state: await this.store.health(),
    };
  }
}
