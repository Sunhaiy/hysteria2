import { Injectable } from '@nestjs/common';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { NodeControlService } from '../domain/node-control.service';
import { OnlinePresenceService } from '../domain/online-presence.service';
import { EntitlementService } from '../entitlement/entitlement.service';

@Injectable()
export class HysteriaAuthService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly entitlements: EntitlementService,
    private readonly nodes: NodeControlService,
    private readonly presence: OnlinePresenceService,
  ) {}

  async authorize(input: {
    nodeId: string;
    tokenValue: string;
    remoteAddr?: string;
    requestedTxBps?: number;
  }) {
    const [token, node] = await Promise.all([
      this.store.findAccessToken(input.tokenValue),
      this.nodes.getNodeForControl(input.nodeId),
    ]);
    if (!token) {
      await this.store.recordAuthEvent({
        nodeId: node?.id,
        granted: false,
        reason: 'token_not_found',
        remoteAddr: input.remoteAddr,
        requestedTxBps: input.requestedTxBps,
        submittedTokenPreview: this.store.previewToken(input.tokenValue),
      });
      return { ok: false as const, reason: 'token_not_found' };
    }
    const user = await this.store.getSessionIdentity(token.userId);
    if (!user || user.status !== 'active') {
      await this.recordDecision(
        input,
        token.id,
        token.userId,
        node?.id,
        false,
        'user_not_active',
      );
      return { ok: false as const, reason: 'user_not_active' };
    }
    if (!node || !node.active || node.protocol !== 'hysteria2') {
      await this.recordDecision(
        input,
        token.id,
        user.id,
        node?.id,
        false,
        'node_unavailable',
      );
      return { ok: false as const, reason: 'node_unavailable' };
    }
    const access = await this.entitlements.getNodeAccess(user.id, node.id);
    if (!access.allowed) {
      await this.recordDecision(
        input,
        token.id,
        user.id,
        node.id,
        false,
        access.reason,
      );
      return { ok: false as const, reason: access.reason };
    }
    const [onlineCount, reconnecting] = await Promise.all([
      this.presence.countForUser(user.id),
      this.store.isRecentReconnect(user.id, input.remoteAddr),
    ]);
    if (onlineCount >= (access.deviceLimit ?? 1) && !reconnecting) {
      await this.recordDecision(
        input,
        token.id,
        user.id,
        node.id,
        false,
        'device_limit_exceeded',
      );
      return { ok: false as const, reason: 'device_limit_exceeded' };
    }
    await Promise.all([
      this.store.markTokenUsed(token.id),
      this.recordDecision(input, token.id, user.id, node.id, true, 'ok'),
    ]);
    return { ok: true as const, id: user.id };
  }

  private recordDecision(
    input: { tokenValue: string; remoteAddr?: string; requestedTxBps?: number },
    accessTokenId: string,
    userId: string,
    nodeId: string | undefined,
    granted: boolean,
    reason: string,
  ) {
    return this.store.recordAuthEvent({
      userId,
      accessTokenId,
      nodeId,
      granted,
      reason,
      remoteAddr: input.remoteAddr,
      requestedTxBps: input.requestedTxBps,
      submittedTokenPreview: this.store.previewToken(input.tokenValue),
    });
  }
}
