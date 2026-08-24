import { Module } from '@nestjs/common';
import { TrafficPackProductsController } from './traffic-pack-products.controller';

@Module({
  controllers: [TrafficPackProductsController],
})
export class TrafficPackProductsModule {}
