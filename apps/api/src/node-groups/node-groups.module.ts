import { Module } from '@nestjs/common';
import { NodeGroupsController } from './node-groups.controller';

@Module({
  controllers: [NodeGroupsController],
})
export class NodeGroupsModule {}
