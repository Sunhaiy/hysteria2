import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { catchError, tap, throwError } from 'rxjs';
import type { SessionPrincipal } from '../common/auth.types';
import { AuditService } from './audit.service';

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal }>();
    if (
      !request.originalUrl.startsWith('/api/admin') ||
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      return next.handle();
    }

    const startedAt = Date.now();
    const path = request.originalUrl.split('?')[0];
    const segments = path.split('/').filter(Boolean);
    const targetType = segments[2] ?? 'admin';
    const targetId = segments.length > 3 ? segments[3] : undefined;
    const record = (success: boolean, error?: unknown) => {
      void this.audit.record({
        actorId: request.principal?.sub,
        action: `admin.${request.method.toLowerCase()}`,
        targetType,
        targetId,
        remoteAddr: request.ip,
        metadata: {
          path,
          success,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 300) : null,
        },
      });
    };

    return next.handle().pipe(
      tap(() => record(true)),
      catchError((error: unknown) => {
        record(false, error);
        return throwError(() => error);
      }),
    );
  }
}
