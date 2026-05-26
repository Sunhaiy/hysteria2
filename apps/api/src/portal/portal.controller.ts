import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { RedeemCodeDto, RequestPlanOrderDto } from '../contracts/http.dto';
import { PortalService } from './portal.service';

@Controller('api/portal')
@UseGuards(JwtAuthGuard)
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get('subscription')
  getSubscription(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getSubscription(principal.sub);
  }

  @Get('plans')
  getPlans() {
    return this.portalService.getPlans();
  }

  @Get('usage')
  getUsage(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getUsage(principal.sub);
  }

  @Get('orders')
  getOrders(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getOrders(principal.sub);
  }

  @Get('access')
  getAccess(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getAccess(principal.sub);
  }

  @Post('orders/request')
  requestPlanOrder(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: RequestPlanOrderDto,
  ) {
    return this.portalService.createPlanOrderRequest(
      principal.sub,
      body.planId,
      body.note,
    );
  }

  @Post('redeem')
  redeemCode(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: RedeemCodeDto,
  ) {
    return this.portalService.redeemCode(principal.sub, body.code);
  }
}
