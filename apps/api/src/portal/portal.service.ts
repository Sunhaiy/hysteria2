import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { ControlPlaneStoreService } from '../domain/control-plane.store';

@Injectable()
export class PortalService {
  constructor(private readonly store: ControlPlaneStoreService) {}

  getSubscription(userId: string) {
    return this.store.getPortalOverview(userId);
  }

  getUsage(userId: string) {
    return this.store.getUsageForUser(userId);
  }

  getOrders(userId: string) {
    return this.store.getManualOrdersForUser(userId);
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
      'bandwidth:',
      `  up: ${bundle.subscription.speedUpMbpsSnapshot} mbps`,
      `  down: ${bundle.subscription.speedDownMbpsSnapshot} mbps`,
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
