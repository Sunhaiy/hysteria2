import { Module } from '@nestjs/common';
import { EpayModule } from '../epay/epay.module';
import { OrderQueryService } from './order-query.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [EpayModule],
  controllers: [OrdersController],
  providers: [OrderQueryService],
})
export class OrdersModule {}
