# SLA documentation

Part A lists the commitments of AWS for the services we use. Part B is the **FlashDeal service level agreement** we define for our own users
(what we promise, how we measure it, what happens when we miss it).

---

## Part A: AWS service level agreements (upstream)

| Service | Monthly uptime commitment | Notes |
|---|---|---|
| Amazon EC2, **single instance** (our design) | **99.5 %** (instance level) | credit 10 % below 99.5 %, 30 % below 99.0 %, 100 % below 95.0 % of that instance's monthly bill |
| Amazon EC2 + EBS, instances in 2 or more Availability Zones | 99.99 % (region level) | only applies if the workload runs in at least two AZs; ours does not |
| Amazon SQS and SNS | 99.9 % | combined "Messaging" SLA |
| Amazon CloudWatch (metrics API, logs ingestion, alarms) | 99.9 % | |
| Amazon S3 Standard (optional backup) | 99.9 % | credits start below 99.9 % |

Claims: open an AWS Support case within the period the SLA states, name the SLA and attach the evidence; credits are applied to future bills, they are the only remedy.
**Learner Lab is an educational sandbox: these credits are not claimable there**, so the figures are used for design and calculation only.

### What the AWS SLAs mean for our architecture

Our request path depends on the EC2 instance (nginx, gateway, Redis, MongoDB, worker all run on it) and on SQS. They are in series, so the availabilities multiply:

```
availability ceiling = EC2 (99.5 %) x SQS (99.9 %) = 0.995 x 0.999 = 0.9940  ->  about 99.4 %
```

CloudWatch is not in the request path, so it does not reduce user-visible availability. A single instance in a single AZ cannot honestly promise more than about 99.4 %
and we also lose time to our own deployments and faults, so we commit to **99.0 %** (below).

| Availability | Allowed downtime per 30-day month |
|---|---|
| 99.99 % | 4.3 minutes |
| 99.9 % | 43.2 minutes |
| 99.5 % | 3.6 hours |
| **99.0 % (our commitment)** | **7.2 hours** |
| 98.0 % | 14.4 hours |

To reach 99.9 % or more the design must change: two instances in two AZs behind an Application Load Balancer (EC2 region-level SLA 99.99 %), a managed database with Multi-AZ instead of MongoDB in a container, Redis as ElastiCache. SQS already meets 99.9 %.

---

## Part B: FlashDeal service level agreement

### 1. Scope
The FlashDeal web application and API reachable at the Elastic IP / domain of the deployment: browse deals, claim a deal, view own orders. The control-room demo endpoints (`/api/admin/*`) are not covered.

### 2. Service levels (SLOs)

| # | Objective | Target | How it is measured |
|---|---|---|---|
| 1 | **Availability** of the application | **99.0 % per calendar month** (7.2 h error budget) | external probe every minute on `GET /api/health` (HTTP 200 and `status = UP`); availability = successful probes / all probes. An EC2 status-check alarm and `flashdeal-queue-backlog` give early warning |
| 2 | **Claim API latency** `POST /api/claim` | p95 below 300 ms, p99 below 800 ms for requests that are not rate limited | `durationMs` in gateway logs, CloudWatch Logs Insights `stats pct(durationMs, 95)`, or the `loadtest.js` / k6 report |
| 3 | **Read latency** `GET /api/deals` | p95 below 200 ms (cache hit 3 s TTL) | same |
| 4 | **Claim processing time** (accepted -> final status stored) | 95 % within 30 s while sustained load is at most 15 claims/s per worker | SQS metric `ApproximateAgeOfOldestMessage`, order timestamps. Capacity estimate: one worker handles 5 claims at once at about 0.3 s each, roughly 17 claims/s; add workers with `docker compose up -d --scale worker=N` for more |
| 5 | **Correctness**: no overselling, one confirmed claim per customer | 100 % (design guarantee: atomic stock update, unique indexes, idempotent worker) | `stockCheck` in `load-test/loadtest.js` after every load test |
| 6 | **Accepted claims are not lost** | 100 % of HTTP 202 responses end as a stored order (CONFIRMED, SOLD_OUT or REJECTED) or sit in the dead-letter queue for review | SQS redundancy, delete-after-save, DLQ alarm, `claims` count vs 202 count in logs |
| 7 | **Rate limiting** (by design, not an outage) | 5 requests/s per IP sustained, burst 10, then HTTP 429 | `rate_limited` log line and the `FlashDeal/RateLimited429` metric |
| 8 | **Error rate** | fewer than 1 % of non-throttled requests answered with 5xx per month | gateway logs |

Throttled requests (HTTP 429) and sold-out outcomes are normal behaviour and do not count as downtime or errors.

### 3. Data protection objectives

| Objective | Target | Mechanism |
|---|---|---|
| Recovery point (RPO) after container or instance restart | 0 (no data loss) | MongoDB data on the EBS volume, journaling |
| RPO after loss of the volume | at most 24 hours | daily EBS snapshot (`aws/snapshot-ebs.sh`, or a scheduled run), optional S3 dump |
| Recovery time (RTO) after container crash | under 1 minute | `restart: unless-stopped`, Docker healthchecks |
| RTO after instance stop / reboot | under 5 minutes | volume remounted from `/etc/fstab`, containers restart by themselves |
| RTO after loss of the instance or volume | under 60 minutes | new instance, `ec2-bootstrap.sh`, restore volume from snapshot (steps in `docs/aws-deploy.md`) |

### 4. Support and incident response

| Severity | Definition | First response | Target resolution |
|---|---|---|---|
| Sev 1 | application down or claims being lost | within 1 hour (24 x 7 for the evaluation week) | 4 hours, or roll back to the previous release |
| Sev 2 | degraded (high latency, queue backlog above 100, one dependency down but service works) | within 4 hours | 1 working day |
| Sev 3 | cosmetic or single-user issue | within 2 working days | next release |

Detection: CloudWatch alarms (queue backlog, 429 rate, EC2 status check, CPU) with e-mail through SNS. Recovery tool: automatic rollback in the pipeline (`docs/cicd-design.md`).

### 5. Maintenance
Deployments by the CI/CD pipeline restart containers (typically 10 to 60 seconds of interruption). Planned maintenance with more than 5 minutes of downtime is announced 24 hours in advance and is not counted against availability for up to 2 hours per month.

### 6. Exclusions
Not counted as downtime: outages of AWS itself beyond the upstream SLAs of Part A; the Learner Lab session ending or the instance being stopped; load above the documented limits (rate limit, worker capacity); misuse or attacks; changes made by the customer; force majeure.

### 7. Service credits (for a commercial offering)

| Monthly availability | Credit on the monthly fee |
|---|---|
| 99.0 % or more | none |
| below 99.0 % and at least 98.0 % | 10 % |
| below 98.0 % and at least 95.0 % | 25 % |
| below 95.0 % | 50 % |

Credits are the sole remedy, must be requested within 30 days with the dates and times of the incident, and are applied to the next invoice. (Defined for the exercise; the project itself is free.)

### 8. Reporting and review
A monthly report from CloudWatch Logs Insights and the probe: availability %, error-budget used, p95 / p99 latency, number of 429s, incidents and their causes. If more than 50 % of the monthly error budget (3.6 hours) is used before mid-month, feature deployments pause until reliability work is done.
