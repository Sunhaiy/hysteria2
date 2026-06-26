import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt, randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { CacheService } from '../cache/cache.service';
import { type SessionPrincipal } from '../common/auth.types';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { MailService } from '../mail/mail.service';

const REGISTER_CODE_TTL_SECONDS = 10 * 60;
const REGISTER_COOLDOWN_SECONDS = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
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

    return this.issueSession(user);
  }

  async requestRegisterCode(rawEmail: string) {
    const email = this.normalizeEmail(rawEmail);

    const existing = await this.store.findUserByEmail(email);
    if (existing) {
      throw new ConflictException('该邮箱已注册，请直接登录');
    }

    const cooldown = await this.cache.get(`reg-cooldown:${email}`);
    if (cooldown) {
      throw new HttpException(
        '验证码发送过于频繁，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateNumericCode();
    await this.cache.set(`reg-code:${email}`, code, REGISTER_CODE_TTL_SECONDS);
    await this.cache.set(
      `reg-cooldown:${email}`,
      '1',
      REGISTER_COOLDOWN_SECONDS,
    );

    await this.mail.sendVerificationCode(email, code);

    return {
      success: true,
      emailed: this.mail.isConfigured,
      cooldownSeconds: REGISTER_COOLDOWN_SECONDS,
    };
  }

  async register(input: {
    email: string;
    code: string;
    password: string;
    displayName?: string;
  }) {
    const email = this.normalizeEmail(input.email);

    const existing = await this.store.findUserByEmail(email);
    if (existing) {
      throw new ConflictException('该邮箱已注册，请直接登录');
    }

    const expected = await this.cache.get(`reg-code:${email}`);
    if (!expected) {
      throw new BadRequestException('验证码已过期，请重新获取');
    }
    if (expected !== input.code.trim()) {
      throw new BadRequestException('验证码错误');
    }

    const passwordHash = await hash(input.password, 10);
    const displayName =
      input.displayName?.trim() || email.split('@')[0] || email;

    await this.store.createUser({
      email,
      displayName,
      passwordHash,
      role: 'member',
      status: 'active',
    });

    await this.cache.del(`reg-code:${email}`);
    await this.cache.del(`reg-cooldown:${email}`);

    const user = await this.store.findUserByEmail(email);
    if (!user) {
      throw new BadRequestException('注册失败，请重试');
    }

    return this.issueSession(user);
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

  private async issueSession(user: {
    id: string;
    role: 'admin' | 'member';
    email: string;
    displayName: string;
    passwordHash: string;
  }) {
    const principal: SessionPrincipal = {
      sub: user.id,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
      jti: randomUUID(),
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

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private generateNumericCode() {
    // 6-digit, zero-padded, cryptographically random.
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }
}
