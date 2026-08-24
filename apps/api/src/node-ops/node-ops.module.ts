import { Module } from '@nestjs/common';
import { NodeOpsController } from './node-ops.controller';
import { NodeOpsService } from './node-ops.service';

@Module({
  controllers: [NodeOpsController],
  providers: [NodeOpsService],
})
export class NodeOpsModule {}
