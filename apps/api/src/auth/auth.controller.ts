import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { LoginDto } from '../contracts/http.dto';
import { AuthService } from './auth.service';

@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.authService.me(principal.sub);
  }
}
