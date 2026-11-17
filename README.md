# FlashDeal (AWS cloud version): flash-sale backend on EC2, SQS, EBS and CloudWatch

Cloud Computing project built on the FlashDeal system-design project. Shoppers claim limited-stock deals. Requests enter
through an **API gateway**, are throttled by a **Redis token bucket**, are buffered in **AWS SQS**, and a **background worker**
applies the business rules (stock, one claim per customer, sale window) against **MongoDB on an EBS volume**.
The whole stack runs in Docker Compose on one **EC2** instance in **AWS Learner Lab**.

```
Browser / k6 --> Elastic IP --> Security Group (22, 80) --> EC2 host
                                                             nginx :80 --> API Gateway --+--> Redis (token bucket, cache, counters)
                                                                                         +--> AWS SQS "flashdeal-claims" --> Worker(s) --> MongoDB (EBS volume)
                                                                                         +--> breaker + retry --> Catalog service --> MongoDB
                              SQS dead-letter queue <-- 3 failed deliveries
                              CloudWatch Logs / metrics / alarms <-- containers (awslogs driver), SQS, EC2
                              IAM instance profile (LabInstanceProfile) gives keyless access to SQS, CloudWatch, EBS
```

| AWS service | Role in the project |
|---|---|
| EC2 | runs Docker Compose (gateway, worker, Redis, MongoDB, catalog, nginx) |
| SQS (+ dead-letter queue) | buffers claims between the gateway and the worker |
| EBS (+ snapshots) | MongoDB data disk mounted at `/mnt/mongo-data`; point-in-time backups |
| VPC Security Group | only ports 22 and 80 are open; Redis / MongoDB / gateway stay private |
| Elastic IP | stable public address for the app and the load tests |
| CloudWatch | container logs (log group `/aws/ec2/flashdeal-logs`), custom 429 metric, alarms |
| IAM (instance profile) | no access keys in code or images |
| SNS, S3 (optional) | alarm e-mails, database dump |

**Start here: `docs/aws-deploy.md`** (deployment, the four demo tests, troubleshooting) and `docs/changes-from-sd.md` (what changed and why).

| Project requirement | Document |
|---|---|
| Cloud model and service usage | this README, `docs/architecture.md`, `docs/aws-deploy.md` |
| Costing | `docs/cost-analysis.md` |
| CI/CD pipeline design (working pipeline in `.github/workflows/ci-cd.yml`) | `docs/cicd-design.md` |
| Cloud security | `docs/security.md` |
| SLA | `docs/sla.md` |
| Index of all of the above | `docs/requirements-mapping.md` |

## Run it

**On AWS (EC2):** follow `docs/aws-deploy.md`. In short, on the instance:

```bash
bash aws/ec2-bootstrap.sh                # once: Docker, Compose, AWS CLI
sudo bash aws/mount-ebs.sh /dev/nvme1n1  # once: MongoDB data disk
bash aws/setup-sqs.sh                    # once: SQS queue + dead-letter queue
cp .env.example .env
docker compose up -d --build             # app on http://<Elastic IP>
```

**On your laptop (optional, real SQS queue, temporary lab credentials in `.env`):**

```bash
docker compose -f docker-compose.local.yml up --build     # app on http://localhost:8080
```

| What | URL (EC2) | URL (laptop) |
|---|---|---|
| App (Shop, My orders, Control room) | http://\<Elastic IP\> | http://localhost:8080 |
| Gateway health | http://\<Elastic IP\>/api/health | http://localhost:3000/api/health |
| SQS queue | AWS console > SQS > `flashdeal-claims` | same |
| MongoDB Compass | not exposed (private); use `docker compose exec mongo mongosh flashdeal` | `mongodb://localhost:27018` |

On EC2 the data survives `docker compose down` because it lives on the EBS volume. To wipe it: `docker compose down` and delete `/mnt/mongo-data/db/*`.
For a clean demo without wiping, use **Reset sale** in the Control room.

## What is stored where

| Store | Data |
|---|---|
| MongoDB `deals` | the catalogue: prices, stock, sale window (seeded by a migration) |
| MongoDB `claims` | one document per claim request: confirmed, sold out or rejected, with price paid and order number |
| Redis | rate-limit buckets, deals cache (3 s), counters for the dashboard |
| AWS SQS | claims waiting for a worker; failed ones end in `flashdeal-claims-dlq` |

## Business rules

- Stock never goes below zero: the worker takes a unit with one atomic update that only matches while `stock > 0`.
- One confirmed claim per customer per deal: checked by the worker and enforced by a unique index in MongoDB.
- A deal can only be claimed inside its sale window.
- Every claim ends as `CONFIRMED`, `SOLD_OUT` or `REJECTED` (already claimed, sale ended, not started, unknown deal).
- Prices and names are copied into the claim, so an order keeps the price paid even if the catalogue changes later.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| POST | `/api/claim` | Body `{userId, dealId}`. Rate limited. Sends the claim to SQS, returns `202 Accepted` |
| GET | `/api/deals` | Rate limited. Redis cache, then circuit breaker + retry to the catalog service, stale cache as fallback |
| GET | `/api/orders?userId=...` | The user's finished claims from MongoDB |
| GET | `/api/health` | Status of Redis, MongoDB, SQS, catalog service, circuit state, counters |
| POST | `/api/admin/catalog-failure` | `{"enabled": true}` breaks the catalog service (demo) |
| POST | `/api/admin/reset-sale` | Restock all deals, restart countdowns, delete claims (demo) |
| POST | `/api/admin/reset-metrics` | Zero the counters |

```bash
curl -i -X POST localhost:3000/api/claim -H "Content-Type: application/json" -d '{"userId":"rv","dealId":"deal-001"}'
curl -s localhost:3000/api/health
```

## Assignment requirements -> where they live

| Requirement | Location |
|---|---|
| Git repo + base docker-compose | `docker-compose.yml` (EC2), `docker-compose.local.yml` (laptop) |
| Gateway with routing | `api-gateway/src/server.js` |
| Rate limiter (token bucket, 429) | `api-gateway/src/middleware/rateLimiter.js` + Lua script in `services/redisClient.js` |
| Health endpoint | `api-gateway/src/routes/health.js` |
| Mock / downstream service nodes | `catalog-service/` |
| Database schema + migration scripts | `db/migrations/`, `db/migrate.js`, `db/schema.md` |
| Redis cache and counters | `routes/deals.js`, `rateLimiter.js` |
| Async queue + worker loop updating the DB | `services/queuePublisher.js`, `worker/src/sqsConsumer.js`, `worker/src/worker.js`, `worker/src/claimProcessor.js` |
| Circuit breaker | `api-gateway/src/services/circuitBreaker.js` |
| Retries with exponential backoff | `services/retry.js` (gateway), `worker/src/sqsConsumer.js` (visibility-timeout backoff + SQS dead-letter queue) |
| Load test script | `load-test/loadtest.js`, `k6-burst.js`, `k6-spike.js` |
| Structured logging / tracing | JSON logs everywhere, one `requestId` across all hops |
| Architecture + data flow diagram | `docs/architecture.md` |
| CI/CD, cost, security, SLA | `.github/workflows/ci-cd.yml`, `docs/cicd-design.md`, `docs/cost-analysis.md`, `docs/security.md`, `docs/sla.md` |
| AWS deployment + tests | `docs/aws-deploy.md`, `aws/` |
| Load test report | `docs/load-test-report-template.md` |

## Live demo script (10 minutes, on AWS)

1. **Test 1:** SSH to the instance via the Elastic IP, `docker compose ps` (all `healthy`; `migrate` exits, that is normal). Show the EC2 instance, Security Group, Elastic IP and IAM instance profile in the console.
2. **Shop.** Open `http://<Elastic IP>`: prices, stock bars and countdowns come from MongoDB. Click **Claim this deal**: *Confirming*, a toast, then a receipt in **My orders**.
3. **Business rules.** Claim the same deal again (*Claimed*), then claim as a second user.
4. **Control room > Send spike of 30.** About 10 pass the rate limiter, 6 get confirmed, the rest are sold out, stock ends at 0 and never below.
5. **Test 2:** k6 from the laptop against the Elastic IP (429s), then the raised-limit run: watch **In queue now** and the SQS console fill and drain.
6. **Test 3:** CloudWatch Logs Insights on `/aws/ec2/flashdeal-logs` (202 vs 429, one `requestId` across gateway and worker).
7. **Test 4:** claim count in MongoDB, `df -h /mnt/mongo-data`, create an EBS snapshot, `docker compose down && up` and show the data is still there.
8. **Fault tolerance.** *Break catalog service* in the Control room: circuit OPEN, stale cache. Optional: `FAIL_RATE=1` to show the SQS dead-letter queue.

## Load testing

Needs Node 18+ on your machine (no `npm install`); for k6 see `docs/aws-deploy.md`. Add `--base http://<Elastic IP>` to test the AWS deployment:

```bash
cd load-test
node loadtest.js --target claim --total 500 --concurrency 50 --reset true
node loadtest.js --target deals --total 500 --concurrency 50
```

Results (throughput, p50/p95/p99, status counts, cache hits, worker counters, stock check) print on screen and are saved to
`load-test/results/`. `--reset true` restocks the sale first.

The limiter is per client IP and the test runs from one machine, so most requests get `429`: that is the limiter working.
To show the queue absorbing real load, raise the limit for one run (set the values in `.env` or inline, then `docker compose up -d api-gateway worker`):

```
RATE_LIMIT_CAPACITY=1000
RATE_LIMIT_REFILL_PER_SEC=1000
```

With a high limit, 500 claims are accepted, the queue fills, the worker drains it, and the stock check shows that
confirmed claims equal units sold even though far more shoppers than units were competing.

## Useful knobs (`.env` or inline, read by docker-compose.yml)

| Variable | Service | Meaning |
|---|---|---|
| `RATE_LIMIT_CAPACITY`, `RATE_LIMIT_REFILL_PER_SEC` | gateway | token bucket size and refill rate |
| `PROCESSING_MS_MIN/MAX` | worker | simulated payment latency (raise it to make the SQS backlog visible) |
| `FAIL_RATE` | worker | e.g. `0.5` makes half of the claims fail to show retries and the SQS dead-letter queue |
| `AWS_REGION`, `SQS_QUEUE_NAME` | gateway, worker | where the queue lives (default `us-east-1`, `flashdeal-claims`) |
| `CACHE_TTL_SEC`, `BREAKER_FAILURES`, `BREAKER_RESET_MS` | gateway | cache lifetime, circuit thresholds (edit in code / compose) |

## Design notes (good viva answers)

- **Why a queue for a flash sale**: thousands of people want the last few units at once. The gateway answers `202` immediately, and workers decide who gets the stock one atomic update at a time, so the database is never hammered and the last unit cannot be sold twice.
- **Token bucket in Lua**: the read-modify-write runs atomically inside Redis, so many gateway instances can share one limiter.
- **Fail open**: if Redis is down the limiter allows traffic and logs an error (availability over protection).
- **Atomic stock update**: `findOneAndUpdate({stock: {$gt: 0}}, {$inc: {stock: -1}})` is applied one at a time per document by MongoDB. The `stock >= 0` validator is a second safety net.
- **At-least-once + idempotency**: the worker deletes the SQS message only after saving; a redelivered message (SQS Standard may deliver twice) hits the unique `claimId` and is ignored.
- **SQS concepts**: *visibility timeout* hides a message from other workers while one processes it; no `DeleteMessage` means it comes back; *redrive policy* sends it to the dead-letter queue after 3 failed deliveries; *long polling* avoids empty-receive API calls.
- **Keyless security**: the IAM instance profile gives the SDK and the Docker log driver temporary credentials; nothing secret is stored in the repo or the images.
- **Known limit**: reserving stock and saving the claim are two writes. A worker crash between them can leave one unit reserved (under-selling, never over-selling). A replica set with transactions would remove this.
- **Eventual consistency**: a claim appears in "My orders" a moment after the `202`. The UI shows it as *Processing* until the worker finishes.
- **Circuit breaker**: after 3 failures the gateway stops calling the catalog service and serves stale cached deals.
- **Other limits**: single EC2 host, Redis and MongoDB (no replication; EBS snapshots are the backup); the demo admin endpoints have no authentication, so restrict port 80 in the Security Group when not demoing; rate limit is per IP; the user name in the app is not real authentication.

## Troubleshooting

See the table at the end of `docs/aws-deploy.md`. Quick ones:

- **Health shows `sqs: DOWN`**: queue not created (`bash aws/setup-sqs.sh`), wrong region, or no credentials (EC2: instance profile + metadata hop limit 2; laptop: lab credentials in `.env`, they change every session).
- **Shop is empty or shows an error**: check `docker compose logs migrate catalog-service`. The `migrate` container must have finished successfully.
- **Everything looks sold out**: click *Reset sale* in the Control room.
- **Port already in use on the laptop** (3000, 8080, 27018): change the left side of that port mapping in `docker-compose.local.yml`.
 
 