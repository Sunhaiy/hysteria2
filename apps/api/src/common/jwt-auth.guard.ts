import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { SessionPrincipal } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal }>();
    const headers = request.headers as Record<
      string,
      string | string[] | undefined
    >;
    const headerValue = headers.authorization;
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice('Bearer '.length);
    try {
      const principal = this.jwtService.verify<SessionPrincipal>(token, {
        secret: process.env.JWT_SECRET ?? 'local-dev-secret',
      });
      request.principal = principal;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
  }
}
