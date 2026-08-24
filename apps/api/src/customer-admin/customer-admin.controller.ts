import {
  Body,
  Controller,
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
import {
  CustomerBalanceAdjustmentDto,
  CustomerPlanSwitchDto,
  CustomerQuotaAdjustmentDto,
  CustomerStatusDto,
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

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.getCustomer(id);
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

  @Post(':id/plan-switch')
  switchPlan(
    @Param('id') id: string,
    @Body() body: CustomerPlanSwitchDto,
    @Headers('idempotency-key') idempotencyKey = '',
  ) {
    return this.commerce.checkout(
      id,
      { offerId: body.offerId },
      idempotencyKey,
    );
  }
}
