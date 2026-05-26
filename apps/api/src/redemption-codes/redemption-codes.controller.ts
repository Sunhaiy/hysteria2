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
      kind: body.kind,
      planId: body.planId,
      trafficBytes: body.trafficBytes,
      amountCents: body.amountCents,
      note: body.note,
      expiresAt: body.expiresAt,
      createdById: principal.sub,
    });
  }

  @Patch(':id')
  updateCode(@Param('id') id: string, @Body() body: UpdateRedemptionCodeDto) {
    return this.store.patchRedemptionCode(id, {
      status: body.status,
    });
  }
}
