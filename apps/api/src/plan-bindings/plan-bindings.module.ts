import { Module } from '@nestjs/common';
import { PlanBindingsController } from './plan-bindings.controller';

@Module({
  controllers: [PlanBindingsController],
})
export class PlanBindingsModule {}
