import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { EntitlementService } from './entitlement.service';
import { QuotaAdjustmentDto, UpdateTrafficPolicyDto } from './entitlement.dto';

@Controller('api/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class EntitlementController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get('access-accounts/:userId')
  getAccount(@Param('userId') userId: string) {
    return this.entitlements.getAccountSummary(userId);
  }

  @Patch('access-accounts/:userId/policy')
  updatePolicy(
    @Param('userId') userId: string,
    @Body() body: UpdateTrafficPolicyDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.entitlements.updateTrafficMultiplier(
      userId,
      body.trafficMultiplier,
      principal.sub,
    );
  }

  @Post('subscriptions/:id/quota-adjustments')
  adjustSubscription(
    @Param('id') id: string,
    @Body() body: QuotaAdjustmentDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.entitlements.adjustSubscriptionQuota(id, body, principal.sub);
  }

  @Post('traffic-entitlements/:id/quota-adjustments')
  adjustTrafficPack(
    @Param('id') id: string,
    @Body() body: QuotaAdjustmentDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.entitlements.adjustTrafficPackQuota(id, body, principal.sub);
  }
}
