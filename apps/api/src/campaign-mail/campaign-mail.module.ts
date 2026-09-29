import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { CampaignMailService } from './campaign-mail.service';
import {
  CampaignMailController,
  CampaignMailUnsubscribeController,
} from './campaign-mail.controller';
@Module({
  imports: [MailModule],
  providers: [CampaignMailService],
  controllers: [CampaignMailController, CampaignMailUnsubscribeController],
  exports: [CampaignMailService],
})
export class CampaignMailModule {}
