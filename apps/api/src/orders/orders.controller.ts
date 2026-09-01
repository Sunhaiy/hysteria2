import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { ManualCreditDto, UpdateManualOrderDto } from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import {
  OrderQueryService,
  type AdminOrderQuery,
  type PaymentAttemptQuery,
} from './order-query.service';

@Controller('api/admin/orders')
@UseGuards(JwtAuthGuard, AdminGuard)
export class OrdersController {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly orderQuery: OrderQueryService,
  ) {}

  @Get()
  listOrders(@Query() query: AdminOrderQuery) {
    return this.orderQuery.list(query);
  }

  @Get('summary')
  summary() {
    return this.orderQuery.summary();
  }

  @Get('payment-attempts')
  paymentAttempts(@Query() query: PaymentAttemptQuery) {
    return this.orderQuery.paymentAttempts(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.orderQuery.detail(id);
  }

  @Post('manual-credit')
  createManualCredit(
    @Body() body: ManualCreditDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.store.createManualOrder({
      userId: body.userId,
      processedById: body.status === 'pending' ? undefined : principal.sub,
      kind: body.kind,
      status: body.status,
      planId: body.planId,
      amountCents: body.amountCents,
      durationDays: body.durationDays,
      trafficBytes: body.trafficBytes,
      note: body.note,
    });
  }

  @Patch(':id')
  updateManualOrder(
    @Param('id') id: string,
    @Body() body: UpdateManualOrderDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.store.patchManualOrder(id, {
      status: body.status,
      processedById: principal.sub,
    });
  }
}
