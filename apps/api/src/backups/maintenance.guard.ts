import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { BackupService } from './backup.service';

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly backups: BackupService) {}

  canActivate(context: ExecutionContext) {
    if (!this.backups.isMaintenanceMode()) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === 'GET' && request.path.startsWith('/api/health')) {
      return true;
    }
    throw new ServiceUnavailableException(
      '系统正在恢复备份，请稍后重试。当前连接不会被主动断开。',
    );
  }
}
