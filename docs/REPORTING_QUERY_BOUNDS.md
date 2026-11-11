# Bounded monitoring and traffic reporting reads

Multi-parent Prisma relation reads with `take: 1` can load every matching history
row before trimming results in the query engine. Do not use that pattern for
the growing `NodeHealthSnapshot` or `NodeServiceCheck` tables. Monitoring checks,
the monitoring overview and the operations summary use `latest-node-history.ts`:
one indexed lateral lookup per requested node, with `LIMIT 1` executed in
PostgreSQL. Nodes without history remain in the response with unknown health.
The worker no longer loads previous service checks that it does not use.

Server monthly reports aggregate `UsageRollup` in Shanghai calendar days using
the existing `(bucketStart, id)` index, then join the much smaller per-node/day
results to inventory. This avoids a whole-ledger scan and repeated per-row
timezone conversions. Raw physical bytes, the legacy tx/rx fallback, server
grouping, retired inventory boundaries and empty calendar days keep their
existing meaning. Historical billing records are never rewritten. The report
worker retains its resource limits, refresh backoff and last successful snapshot.

Validation:

- `pnpm --filter @hysteria/api test` checks callers and existing alert behavior.
- `pnpm --filter @hysteria/api test:reporting` executes the actual query SQL in
  an isolated in-memory PostgreSQL engine. It checks database-side row limits,
  missing nodes, typed timestamps, SQL parameterization, month boundaries,
  physical totals, shared machines and per-day index reads over a large fixture.
  It never reads `DATABASE_URL` or contacts production.
- `pnpm --filter @hysteria/api lint`, `typecheck` and `build` check the API.

The change requires no schema migration or new production dependency. Apply it
through the controlled release process; API and node runtimes must remain
available, and only one worker may own recurring jobs (ADR 0002). When comparing
production results, use bounded read-only queries rather than manually invoking
the alert loop, which can send notifications.

This query fix does not add an external HY2 UDP probe. Agent/core health and
authenticated end-to-end public connectivity remain distinct checks.
