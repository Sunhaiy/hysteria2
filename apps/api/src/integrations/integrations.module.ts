import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { NodeTrafficClientService } from './node-traffic-client.service';

@Module({
  imports: [HttpModule],
  providers: [NodeTrafficClientService],
  exports: [NodeTrafficClientService],
})
export class IntegrationsModule {}
