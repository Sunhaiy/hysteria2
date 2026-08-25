import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NodeLifecycleStatus, NodeProtocol, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  SaveNodePoolDto,
  SaveNodeServerDto,
  UpdateNodeOperationsDto,
} from './node-ops.dto';

@Injectable()
export class NodeOpsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const freshSince = new Date(Date.now() - 45_000);
    const endpointInclude = {
      healthSnapshots: { orderBy: { checkedAt: 'desc' as const }, take: 1 },
      onlinePresence: {
        where: {
          observedAt: { gte: freshSince },
          concurrentClients: { gt: 0 },
        },
        select: { concurrentClients: true },
      },
      accessProfileBindings: {
        include: { accessProfile: { select: { id: true, name: true } } },
        orderBy: [{ priority: 'asc' as const }, { id: 'asc' as const }],
      },
      runtimeCommands: {
        orderBy: { requestedAt: 'desc' as const },
        take: 1,
      },
    };
    const [servers, unassignedNodes] = await Promise.all([
      this.prisma.nodeServer.findMany({
        include: {
          endpoints: {
            include: endpointInclude,
            orderBy: [{ protocol: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.node.findMany({
        where: { serverId: null },
        include: endpointInclude,
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    type Endpoint = (typeof servers)[number]['endpoints'][number];
    const presentEndpoint = (node: Endpoint) => {
      const health = node.healthSnapshots[0];
      const onlineUsers = node.onlinePresence.reduce(
        (total, presence) => total + presence.concurrentClients,
        0,
      );
      const runtimeCommand = node.runtimeCommands[0];
      return {
        id: node.id,
        serverId: node.serverId,
        label: node.label,
        protocol: node.protocol.toLowerCase(),
        hostname: node.hostname,
        port: node.port,
        lifecycleStatus: node.lifecycleStatus.toLowerCase(),
        active: node.active,
        region: node.region,
        provider: node.provider,
        tags: node.tags,
        capacityUsers: node.capacityUsers,
        onlineUsers,
        capacityPercent: node.capacityUsers
          ? Math.round((onlineUsers / node.capacityUsers) * 10_000) / 100
          : null,
        priority: node.accessProfileBindings[0]?.priority ?? null,
        accessProfiles: node.accessProfileBindings.map((binding) => ({
          id: binding.accessProfile.id,
          name: binding.accessProfile.name,
          priority: binding.priority,
        })),
        healthy: health?.healthy ?? null,
        latencyMs: health?.latencyMs ?? null,
        lastCheckedAt: health?.checkedAt.toISOString() ?? null,
        lastSyncAt: node.lastSyncAt?.toISOString() ?? null,
        lastSyncError: node.lastSyncError,
        obfsPassword: node.obfsPassword,
        sni: node.sni,
        allowInsecureTls: node.allowInsecureTls,
        realityPublicKey: node.realityPublicKey,
        realityShortId: node.realityShortId,
        trafficApiBaseUrl: node.trafficApiBaseUrl,
        trafficApiSecretSet: Boolean(node.trafficApiSecret),
        controlApiBaseUrl: node.controlApiBaseUrl,
        controlApiSecretSet: Boolean(node.controlApiSecret),
        runtimeControlConfigured:
          Boolean(node.controlApiBaseUrl && node.controlApiSecret) ||
          node.protocol === NodeProtocol.VLESS_REALITY,
        runtimeState: node.runtimeState.toLowerCase(),
        runtimeStateObservedAt:
          node.runtimeStateObservedAt?.toISOString() ?? null,
        runtimeError: node.runtimeError,
        speedUpMbps: node.speedUpMbps,
        speedDownMbps: node.speedDownMbps,
        latestRuntimeCommand: runtimeCommand
          ? {
              id: runtimeCommand.id,
              action: runtimeCommand.action.toLowerCase(),
              status: runtimeCommand.status.toLowerCase(),
              resultState: runtimeCommand.resultState?.toLowerCase() ?? null,
              error: runtimeCommand.error,
              requestedAt: runtimeCommand.requestedAt.toISOString(),
              startedAt: runtimeCommand.startedAt?.toISOString() ?? null,
              completedAt: runtimeCommand.completedAt?.toISOString() ?? null,
            }
          : null,
      };
    };
    const serverViews = servers.map((server) => {
      const endpoints = server.endpoints.map(presentEndpoint);
      return {
        id: server.id,
        slug: server.slug,
        name: server.name,
        hostname: server.hostname,
        region: server.region,
        provider: server.provider,
        active: server.active,
        onlineUsers: endpoints.reduce(
          (total, endpoint) => total + endpoint.onlineUsers,
          0,
        ),
        healthyEndpoints: endpoints.filter(
          (endpoint) => endpoint.healthy === true,
        ).length,
        endpoints,
      };
    });
    if (unassignedNodes.length) {
      const endpoints = unassignedNodes.map((node) => presentEndpoint(node));
      serverViews.push({
        id: 'unassigned',
        slug: 'unassigned',
        name: '未归属服务器',
        hostname: '',
        region: null,
        provider: null,
        active: false,
        onlineUsers: endpoints.reduce(
          (total, endpoint) => total + endpoint.onlineUsers,
          0,
        ),
        healthyEndpoints: endpoints.filter(
          (endpoint) => endpoint.healthy === true,
        ).length,
        endpoints,
      });
    }
    return {
      servers: serverViews,
      nodes: serverViews.flatMap((server) =>
        server.endpoints.map((endpoint) => ({
          ...endpoint,
          serverName: server.name,
        })),
      ),
    };
  }

  async createServer(input: SaveNodeServerDto) {
    return this.prisma.nodeServer.create({
      data: this.serverData(input),
    });
  }

  async updateServer(id: string, input: SaveNodeServerDto) {
    const existing = await this.prisma.nodeServer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Node server not found');
    return this.prisma.nodeServer.update({
      where: { id },
      data: this.serverData(input),
    });
  }

  async deleteServer(id: string) {
    const server = await this.prisma.nodeServer.findUnique({
      where: { id },
      select: { id: true, _count: { select: { endpoints: true } } },
    });
    if (!server) throw new NotFoundException('Node server not found');
    if (server._count.endpoints > 0) {
      throw new ConflictException(
        'Move or delete every node on this server before deleting it',
      );
    }
    await this.prisma.nodeServer.delete({ where: { id } });
  }

  async createPool(input: SaveNodePoolDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.validateMembers(
        tx,
        input.members.map((member) => member.nodeId),
      );
      return tx.nodePool.create({
        data: {
          slug: input.slug.trim(),
          name: input.name.trim(),
          description: input.description?.trim(),
          region: input.region?.trim(),
          active: input.active,
          members: {
            create: input.members.map((member) => ({
              nodeId: member.nodeId,
              priority: member.priority,
              weight: member.weight ?? 100,
            })),
          },
        },
      });
    });
  }

  async updatePool(id: string, input: SaveNodePoolDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.nodePool.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Node pool not found');
      await this.validateMembers(
        tx,
        input.members.map((member) => member.nodeId),
      );
      await tx.nodePoolMember.deleteMany({ where: { poolId: id } });
      return tx.nodePool.update({
        where: { id },
        data: {
          slug: input.slug.trim(),
          name: input.name.trim(),
          description: input.description?.trim(),
          region: input.region?.trim(),
          active: input.active,
          members: {
            create: input.members.map((member) => ({
              nodeId: member.nodeId,
              priority: member.priority,
              weight: member.weight ?? 100,
            })),
          },
        },
      });
    });
  }

  async updateNode(id: string, input: UpdateNodeOperationsDto) {
    const lifecycleStatus =
      input.lifecycleStatus.toUpperCase() as NodeLifecycleStatus;
    const updated = await this.prisma.node.update({
      where: { id },
      data: {
        lifecycleStatus,
        active: lifecycleStatus !== NodeLifecycleStatus.DISABLED,
        region: input.region?.trim(),
        provider: input.provider?.trim(),
        tags: input.tags,
        capacityUsers: input.capacityUsers,
      },
    });
    return {
      id: updated.id,
      lifecycleStatus: updated.lifecycleStatus.toLowerCase(),
      active: updated.active,
    };
  }

  private async validateMembers(
    tx: Prisma.TransactionClient,
    nodeIds: string[],
  ) {
    if (nodeIds.length === 0 || new Set(nodeIds).size !== nodeIds.length) {
      throw new BadRequestException('A pool requires unique member nodes');
    }
    const count = await tx.node.count({ where: { id: { in: nodeIds } } });
    if (count !== nodeIds.length) throw new BadRequestException('Unknown node');
  }

  private serverData(input: SaveNodeServerDto) {
    return {
      slug: input.slug.trim(),
      name: input.name.trim(),
      hostname: input.hostname.trim(),
      region: input.region?.trim() || null,
      provider: input.provider?.trim() || null,
      active: input.active,
    };
  }
}
