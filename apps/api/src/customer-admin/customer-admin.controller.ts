import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CommerceService } from '../commerce/commerce.service';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { KickService } from '../kick-service/kick-service.service';
import type { PageQuery } from '../common/pagination';
import {
  CustomerBalanceAdjustmentDto,
  CustomerPlanSwitchDto,
  CustomerQuotaOperationDto,
  CustomerQuotaAdjustmentDto,
  CustomerStatusDto,
  CustomerTrafficPolicyDto,
} from './customer-admin.dto';
import {
  CustomerAdminService,
  type CustomerQuery,
} from './customer-admin.service';

@Controller('api/admin/customers')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CustomerAdminController {
  constructor(
    private readonly customers: CustomerAdminService,
    private readonly kick: KickService,
    private readonly auth: AuthService,
    private readonly commerce: CommerceService,
  ) {}

  @Get()
  list(@Query() query: CustomerQuery) {
    return this.customers.listUsers({ ...query, role: 'member' });
  }

  @Get('options')
  options(@Query() query: CustomerQuery) {
    return this.customers.searchOptions(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.getCustomer(id);
  }

  @Get(':id/entitlements')
  entitlements(@Param('id') id: string, @Query() query: PageQuery) {
    return this.customers.getCustomerEntitlements(id, query);
  }

  @Get(':id/access')
  access(@Param('id') id: string, @Query() query: PageQuery) {
    return this.customers.getCustomerAccess(id, query);
  }

  @Post(':id/access-tokens/rotate')
  rotateAccessToken(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.customers.rotateAccessToken(id, principal.sub);
  }

  @Delete(':id/access-tokens/:tokenId')
  revokeAccessToken(
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.customers.revokeAccessToken(id, tokenId, principal.sub);
  }

  @Get(':id/traffic')
  traffic(@Param('id') id: string, @Query() query: PageQuery) {
    return this.customers.getCustomerTraffic(id, query);
  }

  @Get(':id/finance')
  finance(
    @Param('id') id: string,
    @Query('kind') kind: 'orders' | 'wallet' = 'orders',
    @Query() query: PageQuery,
  ) {
    return this.customers.getCustomerFinance(
      id,
      kind === 'wallet' ? 'wallet' : 'orders',
      query,
    );
  }

  @Get(':id/timeline')
  timeline(@Param('id') id: string, @Query() query: PageQuery) {
    return this.customers.getCustomerTimeline(id, query);
  }

  @Patch(':id/status')
  status(
    @Param('id') id: string,
    @Body() body: CustomerStatusDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.customers.setCustomerStatus(id, body.status, principal.sub);
  }

  @Post(':id/kick')
  kickCustomer(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.kick.kickUserEverywhere(id, `admin:${principal.email}`);
  }

  @Post(':id/password-reset')
  resetPassword(
    @Param('id') id: string,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.auth.issuePasswordReset(id, principal.sub);
  }

  @Post(':id/balance-adjustments')
  adjustBalance(
    @Param('id') id: string,
    @Body() body: CustomerBalanceAdjustmentDto,
    @Headers('idempotency-key') idempotencyKey = '',
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.customers.adjustBalance(
      id,
      body.deltaCents,
      body.note,
      principal.sub,
      idempotencyKey,
    );
  }

  @Post(':id/quota-buckets/:bucketId/adjustments')
  adjustQuota(
    @Param('bucketId') bucketId: string,
    @Body() body: CustomerQuotaAdjustmentDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.customers.adjustQuotaBucket(
      bucketId,
      body.remainingBytes,
      body.reason,
      principal.sub,
    );
  }

  @Patch(':id/traffic-policy')
  trafficPolicy(
    @Param('id') id: string,
    @Body() body: CustomerTrafficPolicyDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.customers.setTrafficMultiplier(
      id,
      body.trafficMultiplier,
      principal.sub,
    );
  }

  @Post(':id/quota-adjustments')
  adjustAvailableQuota(
    @Param('id') id: string,
    @Body() body: CustomerQuotaOperationDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.customers.adjustAvailableQuota(id, body, principal.sub);
  }

  @Post(':id/plan-switch')
  switchPlan(
    @Param('id') id: string,
    @Body() body: CustomerPlanSwitchDto,
    @Headers('idempotency-key') idempotencyKey = '',
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.commerce.grantComplimentaryPlan(
      id,
      body.offerId,
      principal.sub,
      idempotencyKey,
    );
  }
}
