import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { UsageSyncModule } from '../usage-sync/usage-sync.module';
import { NodeRuntimeCommandService } from './node-runtime-command.service';
import { NodeOpsController } from './node-ops.controller';
import { NodeOpsService } from './node-ops.service';

@Module({
  imports: [IntegrationsModule, UsageSyncModule],
  controllers: [NodeOpsController],
  providers: [NodeOpsService, NodeRuntimeCommandService],
  exports: [NodeRuntimeCommandService],
})
export class NodeOpsModule {}
