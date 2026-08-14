import { Module } from '@nestjs/common';
import { UsageSyncModule } from '../usage-sync/usage-sync.module';
import { NodesController } from './nodes.controller';

@Module({
  imports: [UsageSyncModule],
  controllers: [NodesController],
})
export class NodesModule {}
