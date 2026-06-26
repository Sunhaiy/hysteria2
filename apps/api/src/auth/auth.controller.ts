import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
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

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Throttle brute-force credential stuffing: 8 attempts / minute / IP.
  @Post('auth/login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
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
  register(@Body() body: RegisterDto) {
    return this.authService.register({
      email: body.email,
      code: body.code,
      password: body.password,
      displayName: body.displayName,
    });
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.authService.logout(principal.jti);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.authService.me(principal.sub);
  }
}
