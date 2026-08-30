import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { EpayController } from './epay.controller';
import { EpayService } from './epay.service';

@Module({
  imports: [CommerceModule],
  controllers: [EpayController],
  providers: [EpayService],
})
export class EpayModule {}
