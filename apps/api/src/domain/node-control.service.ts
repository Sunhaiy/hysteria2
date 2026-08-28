import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NodeLifecycleStatus,
  NodeProtocol,
  NodeRuntimeState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from '../security/secret-cipher.service';

const onlinePresenceFreshnessMs = 45_000;
const syncFreshnessMs = 150_000;
const runningRuntimeStates = new Set<NodeRuntimeState>([
  NodeRuntimeState.ACTIVE,
  NodeRuntimeState.ACTIVATING,
  NodeRuntimeState.DEACTIVATING,
]);

export type NodeProtocolInput = 'hysteria2' | 'vless_reality';

export interface SaveNodeInput {
  protocol?: NodeProtocolInput;
  serverId?: string;
  label: string;
  hostname: string;
  port: number;
  obfsPassword?: string;
  sni?: string;
  pinSHA256?: string;
  allowInsecureTls: boolean;
  realityPublicKey?: string;
  realityShortId?: string;
  realityFingerprint?: string;
  realitySpiderX?: string;
  vlessFlow?: string;
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
  controlApiBaseUrl?: string;
  controlApiSecret?: string;
  active: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
}

export type PatchNodeInput = Partial<SaveNodeInput>;

@Injectable()
export class NodeControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipherService,
  ) {}

  async getNodes() {
    const nodes = await this.prisma.node.findMany({
      where: { retiredAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (nodes.length === 0) return [];

    const presence = await this.prisma.onlinePresence.findMany({
      where: {
        nodeId: { in: nodes.map((node) => node.id) },
        observedAt: {
          gte: new Date(Date.now() - onlinePresenceFreshnessMs),
        },
        concurrentClients: { gt: 0 },
      },
      select: {
        userId: true,
        nodeId: true,
        concurrentClients: true,
        observedAt: true,
      },
    });
    const presenceByNode = new Map<string, typeof presence>();
    for (const item of presence) {
      const entries = presenceByNode.get(item.nodeId) ?? [];
      entries.push(item);
      presenceByNode.set(item.nodeId, entries);
    }
    return nodes.map((node) =>
      this.buildNodeView(node, presenceByNode.get(node.id) ?? []),
    );
  }

  async getNodeById(nodeId: string) {
    const node = await this.prisma.node.findFirst({
      where: { id: nodeId, retiredAt: null },
    });
    return node ? this.presentNode(node) : undefined;
  }

  async getNodesForControl() {
    const nodes = await this.prisma.node.findMany({
      where: { retiredAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return nodes.map((node) => this.presentNodeForControl(node));
  }

  async getNodeForControl(nodeId: string) {
    const node = await this.prisma.node.findFirst({
      where: { id: nodeId, retiredAt: null },
    });
    return node ? this.presentNodeForControl(node) : undefined;
  }

  async createNode(input: SaveNodeInput) {
    try {
      const protocol = input.protocol ?? 'hysteria2';
      this.validateNodeConfiguration({ ...input, protocol });
      const node = await this.prisma.node.create({
        data: {
          serverId: input.serverId,
          protocol: this.toDbNodeProtocol(protocol),
          label: input.label,
          hostname: input.hostname,
          port: input.port,
          obfsPassword: input.obfsPassword,
          sni: input.sni,
          pinSHA256: input.pinSHA256,
          allowInsecureTls: input.allowInsecureTls,
          realityPublicKey: input.realityPublicKey,
          realityShortId: input.realityShortId,
          realityFingerprint: input.realityFingerprint ?? 'chrome',
          realitySpiderX: input.realitySpiderX,
          vlessFlow: input.vlessFlow ?? 'xtls-rprx-vision',
          trafficApiBaseUrl: input.trafficApiBaseUrl,
          trafficApiSecret: this.cipher.encrypt(input.trafficApiSecret),
          controlApiBaseUrl: input.controlApiBaseUrl?.trim() || null,
          controlApiSecret: input.controlApiSecret
            ? this.cipher.encrypt(input.controlApiSecret)
            : null,
          active: input.active,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
        },
      });
      return this.presentNode(node);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async patchNode(nodeId: string, input: PatchNodeInput) {
    try {
      const current = await this.prisma.node.findFirst({
        where: { id: nodeId, retiredAt: null },
      });
      if (!current) throw new NotFoundException(`Unknown node: ${nodeId}`);
      this.validateNodeConfiguration({
        protocol: input.protocol ?? this.fromDbNodeProtocol(current.protocol),
        sni: input.sni !== undefined ? input.sni : current.sni,
        realityPublicKey:
          input.realityPublicKey !== undefined
            ? input.realityPublicKey
            : current.realityPublicKey,
        realityShortId:
          input.realityShortId !== undefined
            ? input.realityShortId
            : current.realityShortId,
        controlApiBaseUrl:
          input.controlApiBaseUrl !== undefined
            ? input.controlApiBaseUrl
            : current.controlApiBaseUrl,
        controlApiSecret:
          input.controlApiSecret !== undefined
            ? input.controlApiSecret
            : current.controlApiSecret,
      });
      const node = await this.prisma.node.update({
        where: { id: nodeId },
        data: this.withDefinedValues({
          serverId: input.serverId,
          protocol: input.protocol
            ? this.toDbNodeProtocol(input.protocol)
            : undefined,
          label: input.label,
          hostname: input.hostname,
          port: input.port,
          obfsPassword: input.obfsPassword,
          sni: input.sni,
          pinSHA256: input.pinSHA256,
          allowInsecureTls: input.allowInsecureTls,
          realityPublicKey: input.realityPublicKey,
          realityShortId: input.realityShortId,
          realityFingerprint: input.realityFingerprint,
          realitySpiderX: input.realitySpiderX,
          vlessFlow: input.vlessFlow,
          trafficApiBaseUrl: input.trafficApiBaseUrl,
          trafficApiSecret: input.trafficApiSecret
            ? this.cipher.encrypt(input.trafficApiSecret)
            : undefined,
          controlApiBaseUrl:
            input.controlApiBaseUrl !== undefined
              ? input.controlApiBaseUrl.trim() || null
              : undefined,
          controlApiSecret: input.controlApiSecret
            ? this.cipher.encrypt(input.controlApiSecret)
            : undefined,
          active: input.active,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
        }),
      });
      return this.presentNode(node);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async deleteNode(nodeId: string) {
    const node = await this.prisma.node.findFirst({
      where: { id: nodeId, retiredAt: null },
      select: {
        id: true,
        active: true,
        lifecycleStatus: true,
        runtimeState: true,
        onlinePresence: {
          where: {
            observedAt: {
              gte: new Date(Date.now() - onlinePresenceFreshnessMs),
            },
            concurrentClients: { gt: 0 },
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!node) throw new NotFoundException(`Unknown node: ${nodeId}`);
    if (node.active || node.lifecycleStatus !== NodeLifecycleStatus.DISABLED) {
      throw new ConflictException('请先停用节点，再删除节点');
    }
    if (node.onlinePresence.length > 0) {
      throw new ConflictException('节点仍有在线连接，暂不能删除');
    }
    if (runningRuntimeStates.has(node.runtimeState)) {
      throw new ConflictException('请先停止节点运行服务，再删除节点');
    }
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { active: false, retiredAt: new Date() },
    });
  }

  async markUserSyncSuccess(nodeId: string) {
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { lastUserSyncAt: new Date() },
    });
  }

  async markTrafficSyncSuccess(nodeId: string) {
    const syncedAt = new Date();
    await this.prisma.node.update({
      where: { id: nodeId },
      data: {
        lastTrafficAt: syncedAt,
        lastSyncAt: syncedAt,
        lastSyncError: null,
      },
    });
  }

  async markPresenceSuccess(nodeId: string) {
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { lastPresenceAt: new Date() },
    });
  }

  async markSyncFailure(nodeId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { lastSyncError: message.slice(0, 1000) },
    });
  }

  private async presentNode(node: Prisma.NodeGetPayload<object>) {
    const presence = await this.prisma.onlinePresence.findMany({
      where: {
        nodeId: node.id,
        observedAt: {
          gte: new Date(Date.now() - onlinePresenceFreshnessMs),
        },
        concurrentClients: { gt: 0 },
      },
      select: {
        userId: true,
        nodeId: true,
        concurrentClients: true,
        observedAt: true,
      },
    });
    return this.buildNodeView(node, presence);
  }

  private presentNodeForControl(node: Prisma.NodeGetPayload<object>) {
    const trafficApiSecret = this.cipher.decrypt(node.trafficApiSecret);
    if (!trafficApiSecret) {
      throw new BadRequestException('Node traffic API secret is missing');
    }
    return {
      ...this.buildNodeView(node, []),
      trafficApiSecret,
      controlApiSecret: this.cipher.decrypt(node.controlApiSecret),
    };
  }

  private buildNodeView(
    node: Prisma.NodeGetPayload<object>,
    presence: Array<{
      userId: string;
      concurrentClients: number;
      observedAt: Date;
    }>,
  ) {
    const latestUsers = new Map<string, number>();
    for (const item of presence) {
      if (item.observedAt.getTime() < Date.now() - onlinePresenceFreshnessMs)
        continue;
      latestUsers.set(item.userId, item.concurrentClients);
    }
    const monitoringStatus = !node.active
      ? 'disabled'
      : node.lastSyncError
        ? 'error'
        : !node.lastSyncAt
          ? 'unknown'
          : node.lastSyncAt.getTime() >= Date.now() - syncFreshnessMs
            ? 'online'
            : 'stale';
    return {
      id: node.id,
      serverId: node.serverId,
      protocol: this.fromDbNodeProtocol(node.protocol),
      label: node.label,
      hostname: node.hostname,
      port: node.port,
      obfsPassword: node.obfsPassword,
      sni: node.sni,
      pinSHA256: node.pinSHA256,
      allowInsecureTls: node.allowInsecureTls,
      realityPublicKey: node.realityPublicKey,
      realityShortId: node.realityShortId,
      realityFingerprint: node.realityFingerprint,
      realitySpiderX: node.realitySpiderX,
      vlessFlow: node.vlessFlow,
      trafficApiBaseUrl: node.trafficApiBaseUrl,
      trafficApiSecretSet: Boolean(node.trafficApiSecret),
      controlApiBaseUrl: node.controlApiBaseUrl,
      controlApiSecretSet: Boolean(node.controlApiSecret),
      runtimeControlConfigured:
        Boolean(node.controlApiBaseUrl && node.controlApiSecret) ||
        node.protocol === NodeProtocol.VLESS_REALITY,
      runtimeState: node.runtimeState?.toLowerCase() ?? 'unknown',
      runtimeStateObservedAt:
        node.runtimeStateObservedAt?.toISOString() ?? null,
      runtimeError: node.runtimeError,
      active: node.active,
      lifecycleStatus: node.lifecycleStatus.toLowerCase(),
      speedUpMbps: node.speedUpMbps,
      speedDownMbps: node.speedDownMbps,
      monitoringStatus,
      lastSyncAt: node.lastSyncAt?.toISOString() ?? null,
      lastSyncError: node.lastSyncError,
      lastUserSyncAt: node.lastUserSyncAt?.toISOString() ?? null,
      lastTrafficAt: node.lastTrafficAt?.toISOString() ?? null,
      lastPresenceAt: node.lastPresenceAt?.toISOString() ?? null,
      concurrentUsers: [...latestUsers.values()].filter((value) => value > 0)
        .length,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    };
  }

  private fromDbNodeProtocol(protocol: NodeProtocol): NodeProtocolInput {
    return protocol === NodeProtocol.VLESS_REALITY
      ? 'vless_reality'
      : 'hysteria2';
  }

  private toDbNodeProtocol(protocol: NodeProtocolInput) {
    return protocol === 'vless_reality'
      ? NodeProtocol.VLESS_REALITY
      : NodeProtocol.HYSTERIA2;
  }

  private validateNodeConfiguration(input: {
    protocol: NodeProtocolInput;
    sni?: string | null;
    realityPublicKey?: string | null;
    realityShortId?: string | null;
    controlApiBaseUrl?: string | null;
    controlApiSecret?: string | null;
  }) {
    if (input.controlApiBaseUrl?.trim() && !input.controlApiSecret?.trim()) {
      throw new BadRequestException(
        'Runtime control agent secret is required when its URL is set',
      );
    }
    if (input.protocol !== 'vless_reality') return;
    if (!input.sni?.trim()) {
      throw new BadRequestException('VLESS + REALITY node requires an SNI');
    }
    if (!input.realityPublicKey?.trim()) {
      throw new BadRequestException(
        'VLESS + REALITY node requires a REALITY public key',
      );
    }
    const shortId = input.realityShortId?.trim() ?? '';
    if (
      shortId &&
      (!/^[0-9a-fA-F]+$/.test(shortId) ||
        shortId.length > 16 ||
        shortId.length % 2 !== 0)
    ) {
      throw new BadRequestException(
        'REALITY short ID must be an even-length hexadecimal value up to 16 characters',
      );
    }
  }

  private withDefinedValues<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as Partial<T>;
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = error.meta?.target;
        const fields = Array.isArray(target)
          ? target.join(', ')
          : typeof target === 'string'
            ? target
            : 'unknown field';
        throw new ConflictException(`Duplicate value for ${fields}`);
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('Target record was not found');
      }
      if (error.code === 'P2003') {
        throw new ConflictException(
          'Node is still referenced by access policies or history; disable it instead',
        );
      }
    }
    throw error;
  }
}
