# ADR 0002: Worker-owned node operations

- Status: Accepted
- Date: 2026-08-24

## Context

Running collectors inside every API process duplicates traffic claims, couples
page latency to node-agent latency, and makes blue-green deployment unsafe.

## Decision

Only `dist/sync-worker.js` runs recurring node work. It owns four independently
locked and timed loops:

- full user and traffic sync every 60 seconds;
- online presence collection every 15 seconds;
- health probing and alert evaluation every 60 seconds;
- Redis manual-check request polling every 2 seconds.

The API writes a short-lived Redis request and immediately returns HTTP 202 for
a manual check. It never calls node agents from that request.

## Consequences

- Exactly one worker instance may be active during cutover.
- API and web releases can be started on new ports without duplicating claims.
- A collector timeout does not block another collector or an HTTP request.
- `OnlinePresence` older than 45 seconds is displayed as stale and excluded
  from live totals.
