import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { CacheService } from '../cache/cache.service';
import { type SessionPrincipal } from '../common/auth.types';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Injectable()
export class AuthService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.store.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const principal: SessionPrincipal = {
      sub: user.id,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
      jti: crypto.randomUUID(),
    };

    const accessToken = await this.jwtService.signAsync(principal, {
      secret: process.env.JWT_SECRET,
      expiresIn: '12h',
    });

    await this.cache.set(
      `session:${principal.jti}`,
      JSON.stringify(principal),
      12 * 60 * 60,
    );

    const { passwordHash: _pw, ...safeUser } = user;
    return {
      accessToken,
      principal,
      user: safeUser,
    };
  }

  async logout(jti: string) {
    await this.cache.del(`session:${jti}`);
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.store.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException('Unknown session subject');
    }

    const { passwordHash: _pw, ...safeUser } = user;
    return {
      user: safeUser,
      role: user.role,
      scope: user.role === 'admin' ? 'admin' : 'portal',
    };
  }
}
