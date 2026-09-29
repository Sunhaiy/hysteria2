import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { HolidayService } from './holiday.service';
@Module({
  imports: [CommerceModule],
  providers: [HolidayService],
  exports: [HolidayService],
})
export class HolidayModule {}
