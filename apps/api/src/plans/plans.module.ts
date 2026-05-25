import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';

@Module({
  controllers: [PlansController],
})
export class PlansModule {}
