import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import QRCode from 'qrcode';
import {
  CommerceService,
  type CheckoutInput,
} from '../commerce/commerce.service';
import { ControlPlaneStoreService } from '../domain/control-plane.store';
import { SettingsService } from '../settings/settings.service';
import { buildPortalAlerts } from './portal-alerts';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildMihomoProfile } from './mihomo-profile';
import { apiPublicUrl } from '../common/public-url';
import {
  calculateMembershipJourney,
  calculateMembershipJourneyForUser,
} from './portal-membership';

type SubscriptionNode = {
  protocol: 'HYSTERIA2' | 'VLESS_REALITY';
  hostname: string;
  port: number;
  portHoppingEnabled?: boolean;
  portHoppingStart?: number | null;
  portHoppingEnd?: number | null;
  portHoppingIntervalSeconds?: number;
  sni: string | null;
  obfsPassword: string | null;
  pinSHA256: string | null;
  allowInsecureTls: boolean;
  realityPublicKey: string | null;
  realityShortId: string | null;
  realityFingerprint: string | null;
  realitySpiderX: string | null;
  vlessFlow: string | null;
};

@Injectable()
export class PortalService {
  constructor(
    private readonly store: ControlPlaneStoreService,
    private readonly settings: SettingsService,
    private readonly commerce: CommerceService,
    @Optional() private readonly entitlements?: EntitlementService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getBranding() {
    return this.settings.getPortalBranding();
  }

  async getSubscription(userId: string) {
    const overview = (await this.hasV2Entitlements(userId))
      ? await this.getV2SubscriptionOverview(userId)
      : await this.store.getPortalOverview(userId);
    const membership = await this.getMembershipJourney(userId, overview);
    return {
      ...overview,
      membership,
      alerts: buildPortalAlerts(overview),
    };
  }

  getPlans() {
    return this.store.getPurchasablePlans();
  }

  getTrafficPackProducts() {
    return this.store.getPurchasableTrafficPackProducts();
  }

  async getUsage(userId: string) {
    const legacyUsage = await this.store.getUsageForUser(userId);
    if (!(await this.hasV2Entitlements(userId))) return legacyUsage;
    return {
      ...legacyUsage,
      ...(await this.getV2QuotaUsage(userId)),
    };
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

  async redeemCode(
    userId: string,
    code: string,
    expectedTrafficPackProductId?: string,
  ) {
    const result = await this.commerce.redeem(
      userId,
      code,
      expectedTrafficPackProductId,
    );

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
    return this.commerce.quoteCheckout(userId, {
      kind: 'plan',
      productId: planId,
      discountCode,
    });
  }

  purchase(
    userId: string,
    planId: string,
    discountCode: string | undefined,
    idempotencyKey: string,
  ) {
    return this.commerce.checkout(
      userId,
      { kind: 'plan', productId: planId, discountCode },
      idempotencyKey,
    );
  }

  quoteTrafficPackPurchase(
    userId: string,
    productId: string,
    discountCode?: string,
  ) {
    return this.commerce.quoteCheckout(userId, {
      kind: 'traffic_pack',
      productId,
      discountCode,
    });
  }

  purchaseTrafficPack(
    userId: string,
    productId: string,
    discountCode: string | undefined,
    idempotencyKey: string,
  ) {
    return this.commerce.checkout(
      userId,
      { kind: 'traffic_pack', productId, discountCode },
      idempotencyKey,
    );
  }

  quoteCheckout(userId: string, input: CheckoutInput) {
    return this.commerce.quoteCheckout(userId, input);
  }

  checkout(userId: string, input: CheckoutInput, idempotencyKey: string) {
    return this.commerce.checkout(userId, input, idempotencyKey);
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  private async hasV2Entitlements(userId: string) {
    if (!this.entitlements || !this.prisma) return false;
    return (
      (await this.prisma.entitlementGrant.count({ where: { userId } })) > 0
    );
  }

  private async getMembershipJourney(
    userId: string,
    overview: {
      user?: { createdAt?: string };
      subscription: { startsAt?: string; endsAt: string };
    },
  ) {
    const now = new Date();
    const registeredAt = new Date(
      overview.user?.createdAt ?? overview.subscription.startsAt ?? now,
    );
    if (!this.prisma) {
      return calculateMembershipJourney({
        registeredAt,
        subscriptionIntervals: overview.subscription.startsAt
          ? [
              {
                startsAt: new Date(overview.subscription.startsAt),
                endsAt: new Date(overview.subscription.endsAt),
              },
            ]
          : [],
        now,
      });
    }

    return calculateMembershipJourneyForUser(this.prisma, {
      userId,
      registeredAt,
      now,
    });
  }

  private async getV2SubscriptionOverview(userId: string) {
    if (!this.entitlements || !this.prisma) {
      throw new NotFoundException('Entitlement service unavailable');
    }
    const access = await this.entitlements.resolveAccess(userId);
    const now = new Date();
    const [user, currentGrants] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          onlinePresence: {
            where: {
              observedAt: { gte: new Date(now.getTime() - 45_000) },
              concurrentClients: { gt: 0 },
            },
            select: { concurrentClients: true },
          },
        },
      }),
      this.getCurrentV2Grants(userId, now),
    ]);
    const eligibleGrantIds = new Set(access.eligibleGrantIds ?? []);
    const grants = currentGrants.filter((grant) =>
      eligibleGrantIds.has(grant.id),
    );
    const primary = grants.find((grant) => grant.kind === 'PLAN') ?? grants[0];
    if (!primary) throw new NotFoundException('No active access entitlement');
    const remaining = (grant: (typeof grants)[number]) =>
      grant.quotaBuckets.reduce(
        (sum, bucket) =>
          sum +
          Number(
            bucket.grantedBytes > bucket.consumedBytes
              ? bucket.grantedBytes - bucket.consumedBytes
              : BigInt(0),
          ),
        0,
      );
    const totalRemaining = grants.reduce(
      (sum, grant) => sum + remaining(grant),
      0,
    );
    const overview = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role.toLowerCase(),
        status: user.status.toLowerCase(),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      subscription: {
        id: primary.id,
        userId,
        planId: primary.productId,
        planName: primary.product.name,
        status: 'active' as const,
        startsAt: primary.startsAt.toISOString(),
        endsAt: primary.endsAt.toISOString(),
        includedTrafficBytes:
          primary.kind === 'PLAN'
            ? primary.quotaBuckets.reduce(
                (sum, bucket) => sum + Number(bucket.grantedBytes),
                0,
              )
            : 0,
        bonusTrafficBytes: 0,
        consumedTrafficBytes:
          primary.kind === 'PLAN'
            ? primary.quotaBuckets.reduce(
                (sum, bucket) => sum + Number(bucket.consumedBytes),
                0,
              )
            : 0,
        speedUpMbpsSnapshot:
          access.allowed && access.speedUpMbps !== undefined
            ? access.speedUpMbps
            : primary.speedUpMbpsSnapshot,
        speedDownMbpsSnapshot:
          access.allowed && access.speedDownMbps !== undefined
            ? access.speedDownMbps
            : primary.speedDownMbpsSnapshot,
        deviceLimitSnapshot:
          access.allowed && access.deviceLimit !== undefined
            ? access.deviceLimit
            : primary.deviceLimitSnapshot,
        currentCycle: primary.quotaBuckets[0]
          ? {
              id: primary.quotaBuckets[0].id,
              startsAt: primary.quotaBuckets[0].startsAt.toISOString(),
              endsAt: primary.quotaBuckets[0].endsAt.toISOString(),
              overageBytes: 0,
            }
          : null,
      },
      plan: {
        id: primary.productId,
        name: primary.kind === 'PLAN' ? primary.product.name : '独立流量权益',
      },
      nodeLabel: access.nodes[0]?.label ?? null,
      remainingBytes: totalRemaining,
      balanceCents: user.balanceCents,
      online: user.onlinePresence.reduce(
        (total, presence) => total + presence.concurrentClients,
        0,
      ),
      packs: grants
        .filter((grant) => grant.kind === 'TRAFFIC_PACK')
        .map((grant) => {
          const remainingBytes = remaining(grant);
          return {
            id: grant.id,
            label: grant.product.name,
            totalBytes: grant.quotaBuckets.reduce(
              (sum, bucket) => sum + Number(bucket.grantedBytes),
              0,
            ),
            remainingBytes,
            status:
              remainingBytes > 0 ? ('active' as const) : ('exhausted' as const),
            expiresAt: grant.endsAt.toISOString(),
            createdAt: grant.createdAt.toISOString(),
            updatedAt: grant.updatedAt.toISOString(),
          };
        }),
    };
    return overview;
  }

  private async getV2QuotaUsage(userId: string) {
    if (!this.entitlements || !this.prisma) {
      throw new NotFoundException('Entitlement service unavailable');
    }
    const access = await this.entitlements.resolveAccess(userId);
    const eligibleGrantIds = new Set(access.eligibleGrantIds ?? []);
    const grants = (await this.getCurrentV2Grants(userId, new Date())).filter(
      (grant) => eligibleGrantIds.has(grant.id),
    );
    const totals = grants.reduce(
      (result, grant) => {
        for (const bucket of grant.quotaBuckets) {
          const remaining = Number(
            bucket.grantedBytes > bucket.consumedBytes
              ? bucket.grantedBytes - bucket.consumedBytes
              : BigInt(0),
          );
          if (grant.kind === 'PLAN') {
            result.baseRemainingBytes += remaining;
            result.consumedBytes += Number(bucket.consumedBytes);
          } else {
            result.packRemainingBytes += remaining;
          }
        }
        return result;
      },
      { consumedBytes: 0, baseRemainingBytes: 0, packRemainingBytes: 0 },
    );
    const primary = grants.find((grant) => grant.kind === 'PLAN') ?? grants[0];
    return {
      subscriptionId: primary?.legacySubscriptionId ?? primary?.id ?? null,
      ...totals,
      totalRemainingBytes:
        totals.baseRemainingBytes + totals.packRemainingBytes,
    };
  }

  private getCurrentV2Grants(userId: string, now: Date) {
    if (!this.prisma) {
      throw new NotFoundException('Entitlement service unavailable');
    }
    return this.prisma.entitlementGrant.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      include: {
        product: true,
        quotaBuckets: {
          where: { startsAt: { lte: now }, endsAt: { gt: now } },
          orderBy: { endsAt: 'asc' },
        },
      },
      orderBy: { endsAt: 'asc' },
    });
  }

  async getAccess(userId: string) {
    const hasV2 = await this.hasV2Entitlements(userId);
    const bundle = hasV2
      ? await this.getV2AccessBundle(userId)
      : await this.store.getAccessBundle(userId);
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
    const subscriptionPath = `/subscribe/${bundle.token.token}`;
    const mihomoSubscriptionPath = `${subscriptionPath}/clash`;
    const publicBaseUrl = apiPublicUrl();
    const subscriptionUrl = `${publicBaseUrl}${subscriptionPath}`;
    const mihomoSubscriptionUrl = `${publicBaseUrl}${mihomoSubscriptionPath}`;
    const subscriptionQrCode = await QRCode.toDataURL(subscriptionUrl, {
      margin: 1,
      width: 256,
    });
    const mihomoSubscriptionQrCode = await QRCode.toDataURL(
      mihomoSubscriptionUrl,
      {
        margin: 1,
        width: 256,
      },
    );
    const configSnippet = this.buildConfigSnippet(bundle.token, bundle.node, {
      up: bundle.subscription.speedUpMbpsSnapshot ?? 0,
      down: bundle.subscription.speedDownMbpsSnapshot ?? 0,
    });

    return {
      token: bundle.token.token,
      uri,
      qrCode,
      subscriptionUrl,
      subscriptionQrCode,
      mihomoSubscriptionUrl,
      mihomoSubscriptionQrCode,
      configSnippet,
      nodeLabel: bundle.node.label,
      protocol:
        bundle.node.protocol === 'VLESS_REALITY'
          ? 'vless_reality'
          : 'hysteria2',
      expiresAt: bundle.subscription.endsAt,
      trafficRemaining: bundle.trafficRemaining,
      nodes,
      subscriptionPath,
      mihomoSubscriptionPath,
      subscriptionStatus: 'active' as const,
    };
  }

  private async getV2AccessBundle(
    userId: string,
    preferredToken?: {
      token: string;
      vlessUuid: string;
    },
  ) {
    if (!this.entitlements || !this.prisma) {
      throw new NotFoundException('Entitlement service unavailable');
    }
    const access = await this.entitlements.resolveAccess(userId);
    if (!access.allowed || !access.nodes.length) {
      throw new NotFoundException('No active access entitlement');
    }
    const [token, rawNodes] = await Promise.all([
      preferredToken
        ? Promise.resolve(preferredToken)
        : this.prisma.accessToken.findFirst({
            where: { userId, revokedAt: null },
            orderBy: { createdAt: 'asc' },
          }),
      this.prisma.node.findMany({
        where: {
          id: { in: access.nodes.map((node) => node.id) },
          retiredAt: null,
        },
      }),
    ]);
    if (!token) throw new NotFoundException('No active access identity');
    const byId = new Map(rawNodes.map((node) => [node.id, node]));
    const nodes = access.nodes
      .map((node) => byId.get(node.id))
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
    const primary = nodes[0];
    if (!primary) throw new NotFoundException('No serviceable access node');
    const accessGrants = access.grants ?? [];
    const endsAt = accessGrants.reduce(
      (latest, grant) => (grant.endsAt > latest ? grant.endsAt : latest),
      accessGrants[0]?.endsAt ?? new Date().toISOString(),
    );
    return {
      token,
      node: primary,
      nodes,
      subscription: {
        speedUpMbpsSnapshot: access.speedUpMbps ?? 0,
        speedDownMbpsSnapshot: access.speedDownMbps ?? 0,
        consumedTrafficBytes: access.consumedBytes ?? 0,
        endsAt,
      },
      trafficRemaining: access.remainingBytes ?? 0,
    };
  }

  private buildConfigSnippet(
    credential: { token: string; vlessUuid: string },
    node: SubscriptionNode,
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
                  publicKey: node.realityPublicKey,
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
    const hoppingRange = this.portHoppingRange(node);
    return [
      `server: ${this.formatHost(node.hostname)}:${node.port}${hoppingRange ? `,${hoppingRange}` : ''}`,
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
      hoppingRange ? 'transport:' : null,
      hoppingRange ? '  udp:' : null,
      hoppingRange
        ? `    hopInterval: ${node.portHoppingIntervalSeconds ?? 30}s`
        : null,
      'socks5:',
      '  listen: 127.0.0.1:1080',
      'http:',
      '  listen: 127.0.0.1:8080',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  }

  async getClientSubscription(tokenValue: string) {
    const bundle = await this.getSubscriptionAccessBundle(tokenValue);
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
      consumedBytes: this.getConsumedBytes(bundle.subscription),
      totalBytes:
        this.getConsumedBytes(bundle.subscription) + bundle.trafficRemaining,
      nodeCount: uris.length,
    };
  }

  async getMihomoSubscription(tokenValue: string) {
    const bundle = await this.getSubscriptionAccessBundle(tokenValue);
    if (bundle.nodes.length === 0) {
      throw new NotFoundException('No active nodes are bound to this plan');
    }

    const site = await this.settings.getSiteInfo();
    const consumedBytes = this.getConsumedBytes(bundle.subscription);
    return {
      content: buildMihomoProfile(bundle.token, bundle.nodes),
      title: site.name,
      expiresAt: new Date(bundle.subscription.endsAt).getTime(),
      consumedBytes,
      totalBytes: consumedBytes + bundle.trafficRemaining,
      nodeCount: bundle.nodes.length,
    };
  }

  private async getSubscriptionAccessBundle(tokenValue: string) {
    if (tokenValue.length < 8 || tokenValue.length > 256) {
      throw new NotFoundException('Subscription not found');
    }

    if (this.entitlements && this.prisma) {
      const token = await this.prisma.accessToken.findUnique({
        where: { token: tokenValue },
      });
      if (!token || token.revokedAt) {
        throw new NotFoundException('Subscription not found');
      }
      const hasV2 =
        (await this.prisma.entitlementGrant.count({
          where: { userId: token.userId },
        })) > 0;
      if (hasV2) return this.getV2AccessBundle(token.userId, token);
    }

    return this.store.getAccessBundleByToken(tokenValue);
  }

  private getConsumedBytes(subscription: object) {
    return 'consumedTrafficBytes' in subscription &&
      typeof subscription.consumedTrafficBytes === 'number'
      ? subscription.consumedTrafficBytes
      : 0;
  }

  private buildNodeUri(
    credential: { token: string; vlessUuid: string },
    node: SubscriptionNode,
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
    const hoppingRange = this.portHoppingRange(node);
    if (hoppingRange) params.set('mport', hoppingRange);
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

  private portHoppingRange(node: SubscriptionNode) {
    return node.portHoppingEnabled &&
      node.portHoppingStart &&
      node.portHoppingEnd
      ? `${node.portHoppingStart}-${node.portHoppingEnd}`
      : null;
  }

  private formatHost(hostname: string) {
    return hostname.includes(':') && !hostname.startsWith('[')
      ? `[${hostname}]`
      : hostname;
  }
}
