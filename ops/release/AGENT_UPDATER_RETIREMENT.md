# Retire Agent updates during a live release

This release removes the updater application, API routes, admin page, signing
key, grants, tables and PostgreSQL enum value. The database removal is a
**contract** migration. Run it after the previous API, web and worker processes
have drained and stopped, never before starting the candidate API.

Keep a verified database backup and the previous release available throughout
cutover. Do not use this procedure to restart Hysteria2 or Xray.

## Before cutover

1. Pause/cancel queued updater rollouts through the old administrator API, allow
   in-flight jobs to reach a terminal state, and stop accepting new updater
   poll/rollout requests at the reverse proxy. Keep reports available while jobs
   finish. An offline machine is not evidence that its update finished.
2. Copy `remove-agent-updater.sh` **and** `remove-agent-updater.py` to each
   installed node. Run `sudo bash remove-agent-updater.sh` and save its JSON
   receipt. The helper requires Python 3.9+ and systemd cgroup freezing support.
   It checks every installation before mutating any, refuses `job.json` or
   `job.json.tmp`, freezes updater cgroups and checks again, then terminates only
   frozen journal-free updaters with restart disabled. Stop failures are fatal.
   It never restarts an Agent or proxy core and verifies Agent PIDs before
   deleting updater binaries, credentials and unit files. `FORCE` is rejected.
3. Retain `agent-current`, `releases/` and the Agent's existing systemd drop-in:
   they still provide the active Agent executable. They contain no running
   updater after the helper succeeds. Remove this residual executable layout
   only after a separately verified manual Agent installation replaces it.
   Preserve historical receipts and unresolved journals for reconciliation.
4. Recheck the database for unfinished `AgentUpdateJob` rows and RUNNING
   rollouts. A job claimed just before an updater was frozen may still require
   explicit reconciliation in the old API; do not erase that evidence or merely
   mark it successful. The contract migration will refuse to proceed while any
   job is nonterminal or has an `activeKey`.
5. Record the old process identities in a private JSON file **before** changing
   service units. It must contain three distinct real PIDs:

   ```json
   [{"role":"api","pid":1234},{"role":"web","pid":1235},{"role":"worker","pid":1236}]
   ```

Load the intended `DATABASE_URL` into the deployment process environment without
printing it. Apply only the additive phase:

```bash
node ops/release/staged-migrations.mjs expand /absolute/new-release
```

This makes a temporary copy of the exact migration files excluding only
`20261116120000_remove_agent_updates`, including newer additive migrations. It
runs normal Prisma `migrate deploy`; it never deletes migration history, changes
checksums, or marks unapplied SQL as applied. The database remains compatible
with the old control-plane processes.

The runner deliberately executes Prisma from that standalone temporary directory:
the release's `prisma.config.ts` pins `migrations.path` and would otherwise
override a temporary `--schema` argument and accidentally include the contract.

Start the candidate API/web on unused ports. The new admin-permission reader
filters retired enum grants before decoding them, so it can coexist with the
old permission enum during this interval. Run readiness, subscription, billing
and process checks. For the candidate preflight use `MIGRATION_PHASE=expand` so
the deliberately deferred contract is the only excluded migration.

## Switch, drain, then remove the old database objects

Switch traffic to the healthy candidate and wait for old Nginx workers/requests
to drain. Replace the single sync worker without running two collectors
simultaneously, then stop the old API/web processes. Verify node-core PIDs,
authorized users and subscription credentials are preserved.

```bash
node ops/release/staged-migrations.mjs contract /absolute/new-release /private/old-processes.json
```

The runner refuses while any recorded old PID still exists. The SQL also takes
the old updater advisory lock, refuses unfinished jobs, uses a 2-second DDL
lock-wait budget and commits table/key/grant/enum removal in one transaction.
If it cannot obtain a lock, it rolls back the database changes. Keep the new
application running; inspect the failure and retry through Prisma's documented
failed-migration recovery only after verifying the transaction rolled back.
Never mark this migration applied without running its SQL.

Run the final preflight with the default `MIGRATION_PHASE=complete`, verify
Prisma's full migration status and confirm all updater routes/pages are absent
and all node updater services/binaries/credentials are gone. The retirement is
complete only after this contract phase succeeds.

Before contract, normal rollback to the old release remains available. After
contract, use a release compatible with the retired tables/enum; do not simply
restart the old updater-enabled API or restore an old database over live billing.

## Local validation

```bash
python3 ops/xray-agent/remove_agent_updater_test.py
node --test ops/release/staged-migrations.test.mjs
RETIREMENT_TEST_DATABASE_URL='postgresql://test_user@127.0.0.1:TEST_PORT/test_db' \
  node --test apps/api/prisma/remove-agent-updates-migration.test.js
```

The uninstaller tests use temporary files and a systemd command adapter; they do
not claim a real Linux service cutover. Validate the helper against a disposable
Linux updater installation before fleet retirement. No serving proxy endpoint
is used as a stop/start smoke test.

The SQL tests require a separate local PostgreSQL database and verify refusal of
unfinished jobs, full transactional retirement, bounded advisory-lock contention,
and continued Prisma permission reads on an existing connection after enum
contraction. The default run skips these database tests until the URL is supplied.
