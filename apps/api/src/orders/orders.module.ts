import { Module } from '@nestjs/common';
import { OrderQueryService } from './order-query.service';
import { OrdersController } from './orders.controller';

@Module({
  controllers: [OrdersController],
  providers: [OrderQueryService],
})
export class OrdersModule {}
