import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { UpdateGroupBuyCampaignsDto } from './group-buy.dto';
import { GroupBuyReconciliationService } from './group-buy-reconciliation.service';
import {
  GroupBuyService,
  type AdminGroupBuyQuery,
  type GroupBuyListQuery,
} from './group-buy.service';

@Controller('api/portal/group-buys')
@UseGuards(JwtAuthGuard)
export class PortalGroupBuyController {
  constructor(private readonly groupBuys: GroupBuyService) {}

  @Get('campaigns')
  campaigns() {
    return this.groupBuys.listCampaigns();
  }

  @Get()
  list(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Query() query: GroupBuyListQuery,
  ) {
    return this.groupBuys.listForMember(principal.sub, query);
  }

  @Get(':idOrCode')
  detail(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('idOrCode') idOrCode: string,
  ) {
    return this.groupBuys.detailForMember(principal.sub, idOrCode);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('id') groupId: string,
  ) {
    return this.groupBuys.cancelForCreator(principal.sub, groupId);
  }
}

@Controller('api/admin/group-buys')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminGroupBuyController {
  constructor(
    private readonly groupBuys: GroupBuyService,
    private readonly reconciliation: GroupBuyReconciliationService,
  ) {}

  @Get('campaigns')
  campaigns() {
    return this.groupBuys.getAdminCampaigns();
  }

  @Put('campaigns')
  updateCampaigns(
    @Body() body: UpdateGroupBuyCampaignsDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.groupBuys.updateAdminCampaigns(
      body.offerIds,
      body.discountPercent,
      body.bonusTrafficGiB,
      principal.sub,
    );
  }

  @Get()
  list(@Query() query: AdminGroupBuyQuery) {
    return this.groupBuys.listAdmin(query);
  }

  @Post('refunds/:id/retry')
  retryRefund(@Param('id') id: string) {
    return this.reconciliation.retryRefundAttempt(id);
  }

  @Post('members/:id/retry-fulfillment')
  retryFulfillment(@Param('id') id: string) {
    return this.reconciliation.retryFallbackFulfillment(id);
  }
}
