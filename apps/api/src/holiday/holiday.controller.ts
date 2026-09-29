import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { EpayService } from '../epay/epay.service';
import { HolidayService } from './holiday.service';
import { HolidayPurchaseDto, HolidayQuoteDto } from './holiday.dto';

@Controller('api')
@UseGuards(JwtAuthGuard)
export class HolidayController {
  constructor(
    private readonly holiday: HolidayService,
    private readonly epay: EpayService,
  ) {}
  @Get('portal/holiday') view(@CurrentPrincipal() p: SessionPrincipal) {
    return this.holiday.view(p.sub);
  }
  @Post('portal/holiday/quote') quote(
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() input: HolidayQuoteDto,
  ) {
    return this.holiday.quote(p.sub, input);
  }
  @Post('portal/holiday/payments') pay(
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() input: HolidayPurchaseDto,
    @Headers('idempotency-key') key = '',
  ) {
    return this.epay.createHolidayPayment(p.sub, input, key);
  }
  @Post('portal/holiday/draw') draw(
    @CurrentPrincipal() p: SessionPrincipal,
    @Headers('idempotency-key') key = '',
  ) {
    return this.holiday.draw(p.sub, key);
  }
  @Get('admin/holiday') @UseGuards(AdminGuard) admin() {
    return this.holiday.adminView();
  }
  @Post('admin/holiday') @UseGuards(AdminGuard) save(
    @CurrentPrincipal() p: SessionPrincipal,
    @Body() input: unknown,
  ) {
    return this.holiday.save(input, p.sub);
  }
}
