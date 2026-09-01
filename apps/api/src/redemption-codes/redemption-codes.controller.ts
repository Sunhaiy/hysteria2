import {
  BadRequestException,
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
import {
  CreateRedemptionCodeDto,
  UpdateRedemptionCodeDto,
} from '../contracts/http.dto';
import {
  ControlPlaneStoreService,
  type RedemptionCodeQuery,
} from '../domain/control-plane.store';
import type { PageQuery } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';

@Controller('api/admin/redemption-codes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RedemptionCodesController {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  listCodes(@Query() query: RedemptionCodeQuery) {
    return this.store.getRedemptionCodes(query);
  }

  @Post()
  async createCode(
    @Body() body: CreateRedemptionCodeDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    const payment = await this.settings.getEpayConfig();
    if (
      payment.checkoutMode === 'epay' &&
      (body.kind === 'plan' || body.kind === 'traffic_pack')
    ) {
      throw new BadRequestException(
        '站内支付启用后不再生成新的套餐或流量包 CDK，已有兑换码仍可正常使用',
      );
    }
    return this.store.createRedemptionCode({
      label: body.label,
      code: body.code,
      kind: body.kind,
      planId: body.planId,
      catalogOfferId: body.catalogOfferId,
      planMode: body.planMode,
      trafficPackProductId: body.trafficPackProductId,
      trafficBytes: body.trafficBytes,
      amountCents: body.amountCents,
      discountPercent: body.discountPercent,
      discountCents: body.discountCents,
      maxUses: body.maxUses,
      count: body.count,
      note: body.note,
      expiresAt: body.expiresAt,
      createdById: principal.sub,
    });
  }

  @Get(':id/uses')
  listCodeUses(@Param('id') id: string, @Query() query: PageQuery) {
    return this.store.getRedemptionCodeUses(id, query);
  }

  @Patch(':id')
  updateCode(@Param('id') id: string, @Body() body: UpdateRedemptionCodeDto) {
    return this.store.patchRedemptionCode(id, {
      status: body.status,
    });
  }
}
