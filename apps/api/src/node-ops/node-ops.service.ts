import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NodeLifecycleStatus, Prisma } from '@prisma/client';
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
    const [servers, pools, nodes] = await Promise.all([
      this.prisma.nodeServer.findMany({
        include: {
          endpoints: {
            orderBy: [{ protocol: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.nodePool.findMany({
        include: {
          profiles: { include: { accessProfile: true } },
          members: {
            include: {
              node: {
                include: {
                  serviceChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
                  onlineSnapshots: {
                    orderBy: { capturedAt: 'desc' },
                    take: 50,
                  },
                },
              },
            },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.node.findMany({
        include: {
          server: true,
          serviceChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
          poolMemberships: { include: { pool: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      servers: servers.map((server) => ({
        id: server.id,
        slug: server.slug,
        name: server.name,
        hostname: server.hostname,
        region: server.region,
        provider: server.provider,
        active: server.active,
        endpoints: server.endpoints.map((node) => ({
          id: node.id,
          label: node.label,
          protocol: node.protocol.toLowerCase(),
          port: node.port,
          active: node.active,
          lifecycleStatus: node.lifecycleStatus.toLowerCase(),
        })),
      })),
      pools: pools.map((pool) => {
        const members = pool.members.map((member) => {
          const latest = member.node.serviceChecks[0];
          const onlineUsers = latest?.onlineUsers ?? 0;
          return {
            memberId: member.id,
            nodeId: member.nodeId,
            nodeLabel: member.node.label,
            priority: member.priority,
            weight: member.weight,
            lifecycleStatus: member.node.lifecycleStatus.toLowerCase(),
            region: member.node.region,
            provider: member.node.provider,
            tags: member.node.tags,
            capacityUsers: member.node.capacityUsers,
            onlineUsers,
            capacityPercent: member.node.capacityUsers
              ? Math.round((onlineUsers / member.node.capacityUsers) * 10000) /
                100
              : null,
            healthy: latest?.healthy ?? null,
            lastCheckedAt: latest?.checkedAt.toISOString() ?? null,
            serviceable:
              pool.active &&
              member.node.active &&
              member.node.lifecycleStatus === NodeLifecycleStatus.ACTIVE &&
              latest?.healthy !== false,
          };
        });
        return {
          id: pool.id,
          slug: pool.slug,
          name: pool.name,
          description: pool.description,
          region: pool.region,
          active: pool.active,
          profileNames: pool.profiles.map(
            (profile) => profile.accessProfile.name,
          ),
          serviceableNodes: members.filter((member) => member.serviceable)
            .length,
          totalNodes: members.length,
          onlineUsers: members.reduce(
            (total, member) => total + member.onlineUsers,
            0,
          ),
          members,
        };
      }),
      nodes: nodes.map((node) => ({
        id: node.id,
        serverId: node.serverId,
        serverName: node.server?.name ?? null,
        label: node.label,
        protocol: node.protocol.toLowerCase(),
        lifecycleStatus: node.lifecycleStatus.toLowerCase(),
        active: node.active,
        region: node.region,
        provider: node.provider,
        tags: node.tags,
        capacityUsers: node.capacityUsers,
        pools: node.poolMemberships.map((membership) => membership.pool.name),
        healthy: node.serviceChecks[0]?.healthy ?? null,
        syncDelaySeconds: node.serviceChecks[0]?.syncDelaySeconds ?? null,
      })),
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
