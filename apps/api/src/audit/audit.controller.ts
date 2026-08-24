import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuditService } from './audit.service';

@Controller('api/admin/audit-logs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query('limit') rawLimit?: string) {
    const limit = Number.parseInt(rawLimit ?? '200', 10);
    return this.audit.list(Number.isFinite(limit) ? limit : 200);
  }
}
