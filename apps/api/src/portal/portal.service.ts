import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PortalService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly settings: SettingsService,
  ) {}

  getBranding() {
    return this.settings.getPortalBranding();
  }

  getSubscription(userId: string) {
    return this.store.getPortalOverview(userId);
  }

  getPlans() {
    return this.store.getPurchasablePlans();
  }

  getUsage(userId: string) {
    return this.store.getUsageForUser(userId);
  }

  getOrders(userId: string) {
    return this.store.getManualOrdersForUser(userId);
  }

  createPlanOrderRequest(userId: string, planId: string, note?: string) {
    return this.store.createPlanOrderRequest({
      userId,
      planId,
      note,
    });
  }

  async redeemCode(userId: string, code: string) {
    const result = await this.store.redeemRedemptionCode(userId, code);

    // A balance top-up may leave the user without an active subscription, so
    // overview/access can legitimately be unavailable — degrade gracefully.
    return {
      ...result,
      overview: await this.safe(() => this.store.getPortalOverview(userId)),
      access: await this.safe(() => this.getAccess(userId)),
    };
  }

  getWallet(userId: string) {
    return this.store.getWallet(userId);
  }

  quotePurchase(userId: string, planId: string, discountCode?: string) {
    return this.store.quotePurchase(userId, planId, discountCode);
  }

  purchase(userId: string, planId: string, discountCode?: string) {
    return this.store.purchaseWithBalance(userId, planId, discountCode);
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  async getAccess(userId: string) {
    const bundle = await this.store.getAccessBundle(userId);
    const params = new URLSearchParams();
    if (bundle.node.sni) {
      params.set('sni', bundle.node.sni);
    }
    if (bundle.node.obfsPassword) {
      params.set('obfs', 'salamander');
      params.set('obfs-password', bundle.node.obfsPassword);
    }
    if (bundle.node.pinSHA256) {
      params.set('pinSHA256', bundle.node.pinSHA256);
    }
    if (bundle.node.allowInsecureTls) {
      params.set('insecure', '1');
    }

    const uri = `hysteria2://${encodeURIComponent(bundle.token.token)}@${bundle.node.hostname}:${bundle.node.port}/?${params.toString()}`;
    const qrCode = await QRCode.toDataURL(uri, {
      margin: 1,
      width: 256,
    });
    const bandwidthLines =
      bundle.subscription.speedUpMbpsSnapshot > 0 ||
      bundle.subscription.speedDownMbpsSnapshot > 0
        ? [
            'bandwidth:',
            bundle.subscription.speedUpMbpsSnapshot > 0
              ? `  up: ${bundle.subscription.speedUpMbpsSnapshot} mbps`
              : null,
            bundle.subscription.speedDownMbpsSnapshot > 0
              ? `  down: ${bundle.subscription.speedDownMbpsSnapshot} mbps`
              : null,
          ]
        : [];
    const configSnippet = [
      `server: ${bundle.node.hostname}:${bundle.node.port}`,
      `auth: ${bundle.token.token}`,
      'tls:',
      `  sni: ${bundle.node.sni ?? bundle.node.hostname}`,
      bundle.node.pinSHA256
        ? `  pinSHA256: ${bundle.node.pinSHA256}`
        : `  insecure: ${bundle.node.allowInsecureTls ? 'true' : 'false'}`,
      bundle.node.obfsPassword ? 'obfs:' : null,
      bundle.node.obfsPassword ? '  type: salamander' : null,
      bundle.node.obfsPassword
        ? `  salamander:\n    password: ${bundle.node.obfsPassword}`
        : null,
      ...bandwidthLines,
      'socks5:',
      '  listen: 127.0.0.1:1080',
      'http:',
      '  listen: 127.0.0.1:8080',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');

    return {
      token: bundle.token.token,
      uri,
      qrCode,
      configSnippet,
      nodeLabel: bundle.node.label,
      expiresAt: bundle.subscription.endsAt,
      trafficRemaining: bundle.trafficRemaining,
    };
  }
}
