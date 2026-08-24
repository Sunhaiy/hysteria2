import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import {
  TrafficAnalyticsService,
  type TrafficQuery,
} from './traffic-analytics.service';

@Controller('api/admin/traffic')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TrafficAnalyticsController {
  constructor(private readonly traffic: TrafficAnalyticsService) {}

  @Get('overview')
  overview(@Query() query: TrafficQuery) {
    return this.traffic.overview(query);
  }

  @Get('details')
  details(@Query() query: TrafficQuery) {
    return this.traffic.details(query);
  }

  @Get('export')
  async export(@Query() query: TrafficQuery, @Res() response: Response) {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="traffic-analysis.csv"',
    );
    response.send(await this.traffic.exportCsv(query));
  }
}
