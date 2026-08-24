import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { CacheService } from '../cache/cache.service';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import {
  hasValidCsrfToken,
  readCookie,
  sessionCookieName,
} from '../auth/session-cookie';
import type { SessionPrincipal } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
    private readonly store: ControlPlaneStoreService,
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
    const bearerToken = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;
    const cookieToken = readCookie(request, sessionCookieName);
    const token = bearerToken ?? cookieToken;
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    if (
      cookieToken &&
      !bearerToken &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !hasValidCsrfToken(request)
    ) {
      throw new UnauthorizedException('Invalid CSRF token');
    }
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

    const current = await this.store.getSessionIdentity(principal.sub);
    if (
      !current ||
      current.status !== 'active' ||
      current.sessionVersion !== principal.sessionVersion
    ) {
      await this.cache.del(`session:${principal.jti}`);
      throw new UnauthorizedException('Session is no longer valid');
    }

    principal = {
      ...principal,
      role: current.role,
      email: current.email,
      displayName: current.displayName,
    };

    request.principal = principal;
    return true;
  }
}
