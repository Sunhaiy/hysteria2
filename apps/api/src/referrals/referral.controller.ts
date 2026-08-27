import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { PageQuery } from '../common/pagination';
import { UpdateReferralSettingsDto } from './referral.dto';
import { type AdminReferralQuery, ReferralService } from './referral.service';

@Controller('api/portal/referrals')
@UseGuards(JwtAuthGuard)
export class PortalReferralController {
  constructor(private readonly referrals: ReferralService) {}

  @Post('code')
  code(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.referrals.getOrCreateCode(principal.sub);
  }

  @Get('summary')
  summary(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.referrals.getMemberSummary(principal.sub);
  }

  @Get()
  list(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Query() query: PageQuery,
  ) {
    return this.referrals.listMemberReferrals(principal.sub, query);
  }
}

@Controller('api/admin/referrals')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminReferralController {
  constructor(private readonly referrals: ReferralService) {}

  @Get('summary')
  summary() {
    return this.referrals.getAdminSummary();
  }

  @Get('settings')
  settings() {
    return this.referrals.getSettings();
  }

  @Patch('settings')
  updateSettings(
    @Body() body: UpdateReferralSettingsDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.referrals.updateSettings(body, principal.sub);
  }

  @Get()
  list(@Query() query: AdminReferralQuery) {
    return this.referrals.listAdminReferrals(query);
  }
}
