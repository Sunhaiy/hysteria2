import { Module } from '@nestjs/common';
import {
  AdminTicketsController,
  PortalTicketsController,
} from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [PortalTicketsController, AdminTicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
