import { Global, Module } from '@nestjs/common';
import { ControlPlaneStoreService } from './control-plane.store';
import { NodeControlService } from './node-control.service';
import { OnlinePresenceService } from './online-presence.service';

@Global()
@Module({
  providers: [
    ControlPlaneStoreService,
    NodeControlService,
    OnlinePresenceService,
  ],
  exports: [
    ControlPlaneStoreService,
    NodeControlService,
    OnlinePresenceService,
  ],
})
export class DomainModule {}
