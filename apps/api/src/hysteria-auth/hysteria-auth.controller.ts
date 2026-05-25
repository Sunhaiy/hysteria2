import { Body, Controller, HttpCode, Post, Query } from '@nestjs/common';
import { HysteriaAuthDto } from '../contracts/http.dto';
import { HysteriaAuthService } from './hysteria-auth.service';

@Controller('integrations/hysteria')
export class HysteriaAuthController {
  constructor(private readonly authService: HysteriaAuthService) {}

  @Post('auth')
  @HttpCode(200)
  authorize(@Query('nodeId') nodeId: string, @Body() body: HysteriaAuthDto) {
    return this.authService.authorize({
      nodeId,
      tokenValue: body.auth,
      remoteAddr: body.addr,
      requestedTxBps: body.tx,
    });
  }
}
