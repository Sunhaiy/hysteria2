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
import { CheckInService, type AdminCheckInQuery } from './check-in.service';
import { UpdateCheckInSettingsDto } from './check-in.dto';

@Controller('api/portal/check-ins')
@UseGuards(JwtAuthGuard)
export class PortalCheckInController {
  constructor(private readonly checkIns: CheckInService) {}

  @Get('today')
  today(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.checkIns.getToday(principal.sub);
  }

  @Post('claim')
  claim(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.checkIns.claim(principal.sub);
  }
}

@Controller('api/admin/check-ins')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCheckInController {
  constructor(private readonly checkIns: CheckInService) {}

  @Get('settings')
  settings() {
    return this.checkIns.getAdminSettings();
  }

  @Patch('settings')
  updateSettings(
    @Body() body: UpdateCheckInSettingsDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.checkIns.updateAdminSettings(body, principal.sub);
  }

  @Get()
  list(@Query() query: AdminCheckInQuery) {
    return this.checkIns.listAdmin(query);
  }
}
