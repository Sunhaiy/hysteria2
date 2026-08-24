import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { CacheService } from '../cache/cache.service';
import { type SessionPrincipal } from '../common/auth.types';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';

const REGISTER_CODE_TTL_SECONDS = 10 * 60;
const REGISTER_COOLDOWN_SECONDS = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
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
    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    return this.issueSession(user);
  }

  async requestRegisterCode(rawEmail: string) {
    if (!(await this.settings.isRegistrationEnabled())) {
      throw new BadRequestException('当前未开放注册，请联系管理员');
    }

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
      emailed: await this.mail.isConfigured(),
      cooldownSeconds: REGISTER_COOLDOWN_SECONDS,
    };
  }

  async register(input: {
    email: string;
    code: string;
    password: string;
    displayName?: string;
  }) {
    if (!(await this.settings.isRegistrationEnabled())) {
      throw new BadRequestException('当前未开放注册，请联系管理员');
    }

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

  async oauthLogin(input: { email: string; displayName: string }) {
    const email = this.normalizeEmail(input.email);

    let user = await this.store.findUserByEmail(email);
    if (!user) {
      // First-time third-party login = registration; honor the open-reg toggle.
      if (!(await this.settings.isRegistrationEnabled())) {
        throw new BadRequestException('当前未开放注册，请联系管理员');
      }
      const passwordHash = await hash(`${randomUUID()}${randomUUID()}`, 10);
      await this.store.createUser({
        email,
        displayName: input.displayName?.trim() || email.split('@')[0] || email,
        passwordHash,
        role: 'member',
        status: 'active',
      });
      user = await this.store.findUserByEmail(email);
    }

    if (!user) {
      throw new BadRequestException('第三方登录失败，请重试');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    return this.issueSession(user);
  }

  async logout(jti: string) {
    await this.cache.del(`session:${jti}`);
    return { success: true };
  }

  async issuePasswordReset(userId: string, createdById: string) {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.store.issuePasswordResetToken({
      userId,
      createdById,
      tokenHash,
      expiresAt,
    });
    const webBaseUrl = (
      process.env.WEB_PUBLIC_URL ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    return {
      resetUrl: `${webBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async resetPassword(rawToken: string, password: string) {
    const passwordHash = await hash(password, 10);
    const consumed = await this.store.consumePasswordResetToken(
      this.hashResetToken(rawToken),
      passwordHash,
    );
    if (!consumed) {
      throw new BadRequestException('Reset link is invalid or expired');
    }
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.store.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException('Unknown session subject');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }
    const safeUser = this.publicUser(user);
    return {
      user: safeUser,
      role: user.role,
      scope: user.role === 'admin' ? 'admin' : 'portal',
    };
  }

  private async issueSession(user: {
    id: string;
    role: 'admin' | 'member';
    status: 'active' | 'suspended' | 'banned';
    email: string;
    displayName: string;
    passwordHash: string;
    sessionVersion: number;
  }) {
    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }
    const principal: SessionPrincipal = {
      sub: user.id,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
      jti: randomUUID(),
      sessionVersion: user.sessionVersion,
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

    const safeUser = this.publicUser(user);
    return {
      accessToken,
      principal,
      user: safeUser,
    };
  }

  private publicUser<T extends { passwordHash?: string }>(
    user: T,
  ): Omit<T, 'passwordHash'> {
    const { passwordHash, ...safeUser } = user;
    void passwordHash;
    return safeUser;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private generateNumericCode() {
    // 6-digit, zero-padded, cryptographically random.
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
