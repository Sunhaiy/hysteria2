# ADR 0003: Offer-owned store links and support tickets

## Status

Accepted.

## Decision

Store links live on `CatalogOffer` because the external SKU changes with the
billing period. The product-level link remains as a read fallback for migrated
records.

Plan CDKs store an explicit `RedemptionPlanMode`. `RENEW` extends an active
subscription when it is the same plan. `REPLACE` restarts the selected plan at
redemption time even when the current plan has the same product.

Support conversations use a dedicated `TicketsService`, `SupportTicket`, and
`SupportTicketMessage`. The member and admin HTTP surfaces share the service,
but ownership checks are applied inside the service rather than trusted to the
controller.

Tutorial client binaries continue to use the existing filesystem adapter and
settings metadata during this compatibility window. The new tutorial module
reads that adapter and exposes the asset with its platform guide.

## Consequences

- Existing product links and CDKs continue to behave as before through
  defaults.
- Offer-specific links can be rolled out without rewriting old rows.
- Ticket lists and message history are independently paginated and indexed.
- Windows, Android, and macOS installers can be uploaded; iOS remains an
  external App Store link.
