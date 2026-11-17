# Database schema (MongoDB, database `flashdeal`)

Created by the migration runner (`db/migrate.js`), which applies every file in `db/migrations/` once and records it
in the `migrations` collection. It runs as the one-shot `migrate` container on every `docker compose up`.

## Collection `deals` (the catalogue, migration `002_create_deals.js`)

| Field | Type | Notes |
|---|---|---|
| `dealId` | string | e.g. `deal-001`. **Unique index** |
| `name`, `description`, `category` | string | shown in the shop |
| `art` | string | which SVG illustration the UI draws |
| `originalPrice`, `salePrice` | number >= 0 | |
| `totalStock` | number | units at the start of the sale |
| `stock` | number **>= 0** | units left. The validator refuses negative values |
| `sold` | number | units confirmed |
| `startsAt`, `endsAt` | date | sale window |
| `saleHours` | number | used by "Reset sale" to restart the countdown |

## Collection `claims` (one document per claim request, migration `001_create_claims.js`)

| Field | Type | Notes |
|---|---|---|
| `claimId` | string | UUID from the gateway. **Unique index**, so a redelivered message is ignored |
| `requestId` | string | correlation id, appears in every log line |
| `userId`, `dealId` | string | who claimed what |
| `status` | enum | `CONFIRMED`, `SOLD_OUT` or `REJECTED` |
| `reason` | enum | for `REJECTED`: `ALREADY_CLAIMED`, `DEAL_ENDED`, `NOT_STARTED`, `UNKNOWN_DEAL` |
| `dealName`, `price` | string, number | **snapshot** at processing time (price paid) |
| `orderNo` | string | `FD-XXXXXXXX`, confirmed claims only |
| `attempts`, `processedBy` | number, string | retries needed, worker container id |
| `createdAt`, `processedAt` | date | gateway accepted / worker finished (difference = time in queue) |

Indexes:
- `claimId` unique
- `(userId, dealId)` **unique, partial (status = CONFIRMED)**: the database itself enforces one confirmed claim per user per deal
- `(userId, createdAt desc)`: "My orders"
- `createdAt desc`

## Business rules (worker, `worker/src/claimProcessor.js`)

1. Same `claimId` twice -> ignored (idempotent).
2. User already has a confirmed claim for the deal -> `REJECTED / ALREADY_CLAIMED`.
3. One atomic `findOneAndUpdate` takes a unit only if `stock > 0` and the sale window is open. No match -> `SOLD_OUT` (or `REJECTED` for an unknown, not started or ended deal).
4. The `CONFIRMED` claim is saved. If that fails, the unit is given back.

Known limit: steps 3 and 4 are two writes, not one transaction (standalone MongoDB). A worker crash between them can leave one unit reserved. Stock may be under-sold after a crash but is never over-sold.

## Redis keys

| Key | Purpose | TTL |
|---|---|---|
| `ratelimit:<ip>` | token bucket state | auto-expires |
| `cache:deals` | cached deals list | 3 s |
| `cache:deals:stale` | last good list, used when the circuit is open | none |
| `metrics:*` | counters shown on the dashboard | none |

## AWS SQS

Standard queue `flashdeal-claims` (visibility timeout 30 s, long polling 20 s) with a dead-letter queue `flashdeal-claims-dlq`.
A message is deleted by the worker only after the claim is saved (delete = ack). A failed message becomes visible again after a
backoff (2 s, 4 s); after 3 failed deliveries (`maxReceiveCount = 3`) SQS moves it to the dead-letter queue by itself.
Delivery is at-least-once, so the worker ignores a repeated `claimId` (unique index) and the stock update is atomic.
Created by `aws/setup-sqs.sh`.
