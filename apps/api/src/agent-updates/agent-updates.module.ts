import { Module } from '@nestjs/common';
import { AgentUpdatesService } from './agent-updates.service';
import {
  AdminAgentUpdatesController,
  AgentUpdaterController,
} from './agent-updates.controller';

@Module({
  controllers: [AdminAgentUpdatesController, AgentUpdaterController],
  providers: [AgentUpdatesService],
})
export class AgentUpdatesModule {}
