import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { SessionPrincipal } from '../common/auth.types';
import {
  LoginDto,
  RegisterDto,
  RequestRegisterCodeDto,
} from '../contracts/http.dto';
import { AuthService } from './auth.service';
import { RequestPasswordResetDto, ResetPasswordDto } from './auth.dto';
import { clearSessionCookies, setSessionCookies } from './session-cookie';

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Throttle brute-force credential stuffing: 8 attempts / minute / IP.
  @Post('auth/login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(body.email, body.password);
    setSessionCookies(response, session.accessToken);
    return this.withoutAccessToken(session);
  }

  // Sending verification codes is the abuse-prone step: 5 / minute / IP, on top
  // of the per-email 60s cooldown enforced in the service.
  @Post('auth/register/request-code')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestRegisterCode(@Body() body: RequestRegisterCodeDto) {
    return this.authService.requestRegisterCode(body.email);
  }

  @Post('auth/register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.register({
      email: body.email,
      code: body.code,
      password: body.password,
      displayName: body.displayName,
    });
    setSessionCookies(response, session.accessToken);
    return this.withoutAccessToken(session);
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(principal.jti);
    clearSessionCookies(response);
    return { success: true };
  }

  @Post('auth/reset-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.password);
  }

  @Post('auth/forgot-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestPasswordReset(@Body() body: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.authService.me(principal.sub);
  }

  private withoutAccessToken<T extends { accessToken: string }>(session: T) {
    const { accessToken, ...payload } = session;
    void accessToken;
    return payload;
  }
}
