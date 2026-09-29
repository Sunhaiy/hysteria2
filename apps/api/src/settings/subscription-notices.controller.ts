import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { SubscriptionNoticesService } from './subscription-notices.service';
@Controller('api/admin/settings/subscription-notices')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SubscriptionNoticesController {
  constructor(private readonly notices: SubscriptionNoticesService) {}
  @Get() get() {
    return this.notices.config();
  }
  @Post() save(
    @Body() body: unknown,
    @CurrentPrincipal() user: SessionPrincipal,
  ) {
    return this.notices.save(body, user.sub);
  }
}
