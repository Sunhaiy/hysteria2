import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { webPublicUrl } from '../common/public-url';
import { CreateEpayGatewayTestDto, CreateEpayPaymentDto } from './epay.dto';
import { EpayService } from './epay.service';

@Controller('api')
export class EpayController {
  constructor(private readonly epay: EpayService) {}

  @Post('portal/payments/epay')
  @UseGuards(JwtAuthGuard)
  createPayment(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: CreateEpayPaymentDto,
    @Headers('idempotency-key') idempotencyKey = '',
  ) {
    return this.epay.createPayment(
      principal.sub,
      body.offerId,
      idempotencyKey,
      body.discountCode,
      body.paymentType,
    );
  }

  @Get('portal/payments/epay/:id')
  @UseGuards(JwtAuthGuard)
  getPayment(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('id') attemptId: string,
  ) {
    return this.epay.getPayment(principal.sub, attemptId);
  }

  @Post('admin/payments/epay/tests')
  @UseGuards(JwtAuthGuard, AdminGuard)
  createGatewayTest(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: CreateEpayGatewayTestDto,
  ) {
    return this.epay.createGatewayTest(principal.sub, body.paymentType);
  }

  @Get('admin/payments/epay/tests/latest')
  @UseGuards(JwtAuthGuard, AdminGuard)
  latestGatewayTest() {
    return this.epay.latestGatewayTest();
  }

  @Get('payments/epay/notify')
  notifyGet(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.writeNotification(query, response);
  }

  @Post('payments/epay/notify')
  notifyPost(
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.writeNotification({ ...query, ...body }, response);
  }

  @Get('payments/epay/return')
  returnGet(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.redirectReturn(query, response);
  }

  @Post('payments/epay/return')
  returnPost(
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.redirectReturn({ ...query, ...body }, response);
  }

  @Get('payments/epay/test-notify')
  testNotifyGet(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.writeTestNotification(query, response);
  }

  @Post('payments/epay/test-notify')
  testNotifyPost(
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.writeTestNotification({ ...query, ...body }, response);
  }

  @Get('payments/epay/test-return')
  testReturnGet(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.redirectTestReturn(query, response);
  }

  @Post('payments/epay/test-return')
  testReturnPost(
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    return this.redirectTestReturn({ ...query, ...body }, response);
  }

  private async writeNotification(
    parameters: Record<string, unknown>,
    response: Response,
  ) {
    const result = await this.epay.processCallback(parameters);
    response
      .type('text/plain')
      .status(200)
      .send(result.accepted ? 'success' : 'fail');
  }

  private async redirectReturn(
    parameters: Record<string, unknown>,
    response: Response,
  ) {
    const result = await this.epay.processCallback(parameters);
    const query = new URLSearchParams({
      payment: result.accepted ? 'success' : 'failed',
    });
    if (result.attemptId) query.set('attempt', result.attemptId);
    response.redirect(
      302,
      `${webPublicUrl()}/portal/orders?${query.toString()}`,
    );
  }

  private async writeTestNotification(
    parameters: Record<string, unknown>,
    response: Response,
  ) {
    const result = await this.epay.processGatewayTestCallback(parameters);
    response
      .type('text/plain')
      .status(200)
      .send(result.accepted ? 'success' : 'fail');
  }

  private async redirectTestReturn(
    parameters: Record<string, unknown>,
    response: Response,
  ) {
    const result = await this.epay.processGatewayTestCallback(parameters);
    const query = new URLSearchParams({
      epayTest: result.accepted ? 'success' : 'failed',
    });
    if (result.attemptId) query.set('attempt', result.attemptId);
    response.redirect(
      302,
      `${webPublicUrl()}/admin/settings?${query.toString()}`,
    );
  }
}
