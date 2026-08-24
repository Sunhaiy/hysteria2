import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ReportingService } from './reporting.service';

@Controller('api/admin/reporting')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('summary')
  getSummary() {
    return this.reporting.getCommerceSummary();
  }

  @Get('orders.csv')
  async exportOrders(@Res() response: Response) {
    const date = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="orders-${date}.csv"`,
    );
    response.send(await this.reporting.exportOrdersCsv());
  }
}
