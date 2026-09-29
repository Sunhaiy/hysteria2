import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../common/admin.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import type { SessionPrincipal } from '../common/auth.types';
import { CampaignMailService } from './campaign-mail.service';
@Controller('api/admin/campaign-mail')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CampaignMailController {
  constructor(private readonly service: CampaignMailService) {}
  @Get() list() {
    return this.service.list();
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
  @Post('preview') preview(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
    @CurrentPrincipal() actor: SessionPrincipal,
  ) {
    return this.service.preview(body, actor.sub, key ?? '');
  }
  @Post(':id/send') send(
    @Param('id') id: string,
    @Body() body: { confirmed?: boolean },
    @CurrentPrincipal() actor: SessionPrincipal,
  ) {
    return this.service.queue(id, actor.sub, body?.confirmed);
  }
  @Post(':id/cancel') cancel(
    @Param('id') id: string,
    @CurrentPrincipal() actor: SessionPrincipal,
  ) {
    return this.service.cancel(id, actor.sub);
  }
}
@Controller('api/campaign-mail/unsubscribe')
export class CampaignMailUnsubscribeController {
  constructor(private readonly service: CampaignMailService) {}
  @Get(':userId/:signature') page(
    @Param('userId') userId: string,
    @Param('signature') signature: string,
    @Res() res: Response,
  ) {
    this.service.verifyUnsubscribe(userId, signature);
    res.setHeader('Cache-Control', 'no-store');
    res
      .type('html')
      .send(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="robots" content="noindex"><title>退订活动邮件</title><body><h1>退订活动邮件</h1><p>不影响验证码、订单或必要的服务通知。</p><form method="post"><button type="submit">确认退订</button></form></body></html>',
      );
  }
  @Post(':userId/:signature') async unsubscribe(
    @Param('userId') userId: string,
    @Param('signature') signature: string,
    @Res() res: Response,
  ) {
    await this.service.unsubscribe(userId, signature);
    res.setHeader('Cache-Control', 'no-store');
    res
      .type('html')
      .send(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="robots" content="noindex"><title>已退订</title><body><h1>已退订活动邮件</h1><p>验证码、订单与必要的服务通知不受影响。</p></body></html>',
      );
  }
}
