import { Module } from '@nestjs/common';
import { RedemptionCodesController } from './redemption-codes.controller';

@Module({
  controllers: [RedemptionCodesController],
})
export class RedemptionCodesModule {}
