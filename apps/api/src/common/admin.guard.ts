import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionPrincipal } from './auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal }>();
    if (request.principal?.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    return true;
  }
}
