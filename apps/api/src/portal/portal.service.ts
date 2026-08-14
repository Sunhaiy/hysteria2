import { Injectable, NotFoundException } from '@nestjs/common';
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
    const uri = this.buildNodeUri(bundle.token, bundle.node);
    const nodes = bundle.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      protocol:
        node.protocol === 'VLESS_REALITY' ? 'vless_reality' : 'hysteria2',
      uri: this.buildNodeUri(bundle.token, node, node.label),
    }));
    const qrCode = await QRCode.toDataURL(uri, {
      margin: 1,
      width: 256,
    });
    const configSnippet = this.buildConfigSnippet(bundle.token, bundle.node, {
      up: bundle.subscription.speedUpMbpsSnapshot,
      down: bundle.subscription.speedDownMbpsSnapshot,
    });

    return {
      token: bundle.token.token,
      uri,
      qrCode,
      configSnippet,
      nodeLabel: bundle.node.label,
      protocol:
        bundle.node.protocol === 'VLESS_REALITY'
          ? 'vless_reality'
          : 'hysteria2',
      expiresAt: bundle.subscription.endsAt,
      trafficRemaining: bundle.trafficRemaining,
      nodes,
    };
  }

  private buildConfigSnippet(
    credential: { token: string; vlessUuid: string },
    node: {
      protocol: 'HYSTERIA2' | 'VLESS_REALITY';
      hostname: string;
      port: number;
      sni: string | null;
      obfsPassword: string | null;
      pinSHA256: string | null;
      allowInsecureTls: boolean;
      realityPublicKey: string | null;
      realityShortId: string | null;
      realityFingerprint: string | null;
      realitySpiderX: string | null;
      vlessFlow: string | null;
    },
    bandwidth: { up: number; down: number },
  ) {
    if (node.protocol === 'VLESS_REALITY') {
      return JSON.stringify(
        {
          outbounds: [
            {
              protocol: 'vless',
              settings: {
                address: node.hostname,
                port: node.port,
                id: credential.vlessUuid,
                encryption: 'none',
                flow: node.vlessFlow ?? 'xtls-rprx-vision',
              },
              streamSettings: {
                network: 'tcp',
                security: 'reality',
                realitySettings: {
                  serverName: node.sni,
                  fingerprint: node.realityFingerprint ?? 'chrome',
                  password: node.realityPublicKey,
                  shortId: node.realityShortId ?? '',
                  spiderX: node.realitySpiderX ?? '',
                },
              },
            },
          ],
        },
        null,
        2,
      );
    }

    const bandwidthLines =
      bandwidth.up > 0 || bandwidth.down > 0
        ? [
            'bandwidth:',
            bandwidth.up > 0 ? `  up: ${bandwidth.up} mbps` : null,
            bandwidth.down > 0 ? `  down: ${bandwidth.down} mbps` : null,
          ]
        : [];
    return [
      `server: ${this.formatHost(node.hostname)}:${node.port}`,
      `auth: ${credential.token}`,
      'tls:',
      `  sni: ${node.sni ?? node.hostname}`,
      node.pinSHA256
        ? `  pinSHA256: ${node.pinSHA256}`
        : `  insecure: ${node.allowInsecureTls ? 'true' : 'false'}`,
      node.obfsPassword ? 'obfs:' : null,
      node.obfsPassword ? '  type: salamander' : null,
      node.obfsPassword
        ? `  salamander:\n    password: ${node.obfsPassword}`
        : null,
      ...bandwidthLines,
      'socks5:',
      '  listen: 127.0.0.1:1080',
      'http:',
      '  listen: 127.0.0.1:8080',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  }

  async getClientSubscription(tokenValue: string) {
    if (!/^hy2_[a-f0-9]{24}$/.test(tokenValue)) {
      throw new NotFoundException('Subscription not found');
    }

    const bundle = await this.store.getAccessBundleByToken(tokenValue);
    if (bundle.nodes.length === 0) {
      throw new NotFoundException('No active nodes are bound to this plan');
    }

    const site = await this.settings.getSiteInfo();
    const uris = bundle.nodes.map((node) =>
      this.buildNodeUri(bundle.token, node, `${site.name}-${node.label}`),
    );

    return {
      content: Buffer.from(uris.join('\n'), 'utf8').toString('base64'),
      title: site.name,
      expiresAt: new Date(bundle.subscription.endsAt).getTime(),
      consumedBytes: bundle.subscription.consumedTrafficBytes,
      totalBytes:
        bundle.subscription.consumedTrafficBytes + bundle.trafficRemaining,
      nodeCount: uris.length,
    };
  }

  private buildNodeUri(
    credential: { token: string; vlessUuid: string },
    node: {
      protocol: 'HYSTERIA2' | 'VLESS_REALITY';
      hostname: string;
      port: number;
      sni: string | null;
      obfsPassword: string | null;
      pinSHA256: string | null;
      allowInsecureTls: boolean;
      realityPublicKey: string | null;
      realityShortId: string | null;
      realityFingerprint: string | null;
      realitySpiderX: string | null;
      vlessFlow: string | null;
    },
    label?: string,
  ) {
    const params = new URLSearchParams();
    if (node.protocol === 'VLESS_REALITY') {
      params.set('encryption', 'none');
      if (node.vlessFlow) params.set('flow', node.vlessFlow);
      params.set('security', 'reality');
      if (node.sni) params.set('sni', node.sni);
      params.set('fp', node.realityFingerprint ?? 'chrome');
      if (node.realityPublicKey) params.set('pbk', node.realityPublicKey);
      params.set('sid', node.realityShortId ?? '');
      params.set('type', 'tcp');
      if (node.realitySpiderX) params.set('spx', node.realitySpiderX);

      const fragment = label ? `#${encodeURIComponent(label)}` : '';
      return `vless://${credential.vlessUuid}@${this.formatHost(node.hostname)}:${node.port}?${params.toString()}${fragment}`;
    }

    if (node.sni) params.set('sni', node.sni);
    if (node.obfsPassword) {
      params.set('obfs', 'salamander');
      params.set('obfs-password', node.obfsPassword);
    }
    if (node.pinSHA256) params.set('pinSHA256', node.pinSHA256);
    if (node.allowInsecureTls) params.set('insecure', '1');

    const query = params.toString();
    const fragment = label ? `#${encodeURIComponent(label)}` : '';
    return `hysteria2://${encodeURIComponent(credential.token)}@${this.formatHost(node.hostname)}:${node.port}/${query ? `?${query}` : ''}${fragment}`;
  }

  private formatHost(hostname: string) {
    return hostname.includes(':') && !hostname.startsWith('[')
      ? `[${hostname}]`
      : hostname;
  }
}
