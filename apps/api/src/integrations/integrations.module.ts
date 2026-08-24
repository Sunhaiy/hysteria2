import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { NodeTrafficClientService } from './node-traffic-client.service';
import {
  HysteriaNodeAdapter,
  NodeAdapterRegistry,
  TestNodeAdapter,
  XrayHttpNodeAdapter,
} from './node.adapter';

@Module({
  imports: [HttpModule],
  providers: [
    NodeTrafficClientService,
    HysteriaNodeAdapter,
    XrayHttpNodeAdapter,
    TestNodeAdapter,
    NodeAdapterRegistry,
  ],
  exports: [NodeTrafficClientService, NodeAdapterRegistry],
})
export class IntegrationsModule {}
