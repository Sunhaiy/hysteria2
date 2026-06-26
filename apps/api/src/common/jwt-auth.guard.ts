import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { CacheService } from '../cache/cache.service';
import type { SessionPrincipal } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext) {
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
    let principal: SessionPrincipal;
    try {
      principal = this.jwtService.verify<SessionPrincipal>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }

    // A valid signature is not enough: the session must still be live in the
    // cache. Logging out (or an admin revoking) deletes the session entry, so a
    // signed-but-revoked token is rejected here even before it expires.
    if (!principal.jti) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    const session = await this.cache.get(`session:${principal.jti}`);
    if (!session) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    request.principal = principal;
    return true;
  }
}
