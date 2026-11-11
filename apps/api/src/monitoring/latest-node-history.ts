import { NodeHealthSnapshot, NodeServiceCheck, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Reader = Pick<PrismaService, '$queryRaw'>;

// Prisma's multi-parent relation `take: 1` can fetch the entire history and
// trim it in memory. LATERAL enforces one indexed lookup per node in Postgres.
async function latest<T extends { nodeId: string }>(
  prisma: Reader,
  nodeIds: string[],
  table: 'NodeHealthSnapshot' | 'NodeServiceCheck',
): Promise<Map<string, T>> {
  if (nodeIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<T[]>(Prisma.sql`
    SELECT snapshot.*
    FROM "Node" node
    JOIN LATERAL (
      SELECT history.* FROM ${Prisma.raw(`"${table}"`)} history
      WHERE history."nodeId" = node.id
      ORDER BY history."checkedAt" DESC
      LIMIT 1
    ) snapshot ON TRUE
    WHERE node.id IN (${Prisma.join(nodeIds)})
  `);
  return new Map(rows.map((row) => [row.nodeId, row]));
}

export function latestNodeHealth(prisma: Reader, nodeIds: string[]) {
  return latest<NodeHealthSnapshot>(prisma, nodeIds, 'NodeHealthSnapshot');
}

export function latestNodeChecks(prisma: Reader, nodeIds: string[]) {
  return latest<NodeServiceCheck>(prisma, nodeIds, 'NodeServiceCheck');
}
