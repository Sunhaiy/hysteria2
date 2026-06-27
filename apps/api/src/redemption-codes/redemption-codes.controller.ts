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
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import {
  CreateRedemptionCodeDto,
  UpdateRedemptionCodeDto,
} from '../contracts/http.dto';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Controller('api/admin/redemption-codes')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RedemptionCodesController {
  constructor(private readonly store: ControlPlaneStoreService) {}

  @Get()
  listCodes() {
    return this.store.getRedemptionCodes();
  }

  @Post()
  createCode(
    @Body() body: CreateRedemptionCodeDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.store.createRedemptionCode({
      label: body.label,
      code: body.code,
      kind: body.kind,
      planId: body.planId,
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
  listCodeUses(@Param('id') id: string) {
    return this.store.getRedemptionCodeUses(id);
  }

  @Patch(':id')
  updateCode(@Param('id') id: string, @Body() body: UpdateRedemptionCodeDto) {
    return this.store.patchRedemptionCode(id, {
      status: body.status,
    });
  }
}
