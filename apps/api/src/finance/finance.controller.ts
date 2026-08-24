import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CreateNodeCostDto, CreateRefundDto } from './finance.dto';
import { FinanceService, type FinanceQuery } from './finance.service';

@Controller('api/admin/finance')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  summary(@Query() query: FinanceQuery) {
    return this.finance.summary(query);
  }

  @Get('orders')
  orders(@Query() query: FinanceQuery) {
    return this.finance.orders(query);
  }

  @Get('ledger')
  ledger(@Query() query: FinanceQuery) {
    return this.finance.ledger(query);
  }

  @Get('refunds')
  refunds(@Query() query: FinanceQuery) {
    return this.finance.refunds(query);
  }

  @Post('orders/:orderId/refunds')
  refund(
    @Param('orderId') orderId: string,
    @Body() body: CreateRefundDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.finance.createRefund(orderId, body, principal.sub);
  }

  @Get('node-costs')
  nodeCosts(@Query() query: FinanceQuery) {
    return this.finance.nodeCosts(query);
  }

  @Post('node-costs')
  createNodeCost(@Body() body: CreateNodeCostDto) {
    return this.finance.createNodeCost(body);
  }

  @Get('export')
  async export(
    @Query('kind') kind: string,
    @Query() query: FinanceQuery,
    @Res() response: Response,
  ) {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="finance-${kind === 'ledger' ? 'ledger' : 'orders'}.csv"`,
    );
    response.send(await this.finance.exportCsv(kind, query));
  }
}
