import { Global, Module } from '@nestjs/common';
import { ControlPlaneStoreService } from './control-plane.store';

@Global()
@Module({
  providers: [ControlPlaneStoreService],
  exports: [ControlPlaneStoreService],
})
export class DomainModule {}
