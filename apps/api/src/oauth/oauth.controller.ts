import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { OAuthExchangeDto } from '../contracts/http.dto';
import { OAuthService } from './oauth.service';
import { setSessionCookies } from '../auth/session-cookie';

@Controller('api/auth/oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('providers')
  providers() {
    return this.oauth.providersStatus();
  }

  @Get(':provider/start')
  async start(@Param('provider') provider: string, @Res() res: Response) {
    try {
      const url = await this.oauth.buildAuthorizeUrl(provider);
      res.redirect(url);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : '第三方登录暂不可用';
      res.redirect(
        `${this.oauth.webBase()}/login?oauth_error=${encodeURIComponent(message)}`,
      );
    }
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    const web = this.oauth.webBase();
    try {
      const oneTime = await this.oauth.handleCallback(provider, code, state);
      res.redirect(`${web}/oauth/callback?code=${oneTime}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '登录失败';
      res.redirect(`${web}/login?oauth_error=${encodeURIComponent(message)}`);
    }
  }

  @Post('exchange')
  @HttpCode(200)
  async exchange(
    @Body() body: OAuthExchangeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.oauth.exchange(body.code);
    setSessionCookies(response, session.accessToken);
    const { accessToken, ...payload } = session;
    void accessToken;
    return payload;
  }
}
