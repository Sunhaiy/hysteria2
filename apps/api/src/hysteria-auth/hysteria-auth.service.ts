import { Injectable } from '@nestjs/common';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Injectable()
export class HysteriaAuthService {
  constructor(private readonly store: ControlPlaneStoreService) {}

  authorize(input: {
    nodeId: string;
    tokenValue: string;
    remoteAddr?: string;
    requestedTxBps?: number;
  }) {
    return this.store.authorizeHysteriaAccess(input);
  }
}
