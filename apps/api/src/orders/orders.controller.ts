import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { ManualCreditDto } from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/orders')
@UseGuards(JwtAuthGuard, AdminGuard)
export class OrdersController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listOrders() {
    return this.store.getManualOrders();
  }

  @Post('manual-credit')
  createManualCredit(
    @Body() body: ManualCreditDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.store.createManualOrder({
      userId: body.userId,
      processedById: principal.sub,
      kind: body.kind,
      amountCents: body.amountCents,
      durationDays: body.durationDays,
      trafficBytes: body.trafficBytes,
      note: body.note,
    });
  }
}
