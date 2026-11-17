# What changed from the System Design version (RabbitMQ, local) to the Cloud Computing version (AWS)

| Area | SD version | CC version | Why |
|---|---|---|---|
| Message queue | RabbitMQ container (`amqplib`) | **AWS SQS** (`@aws-sdk/client-sqs`) | Managed, scalable, no broker to run or patch |
| Gateway publish (`queuePublisher.js`) | confirm-channel `sendToQueue` | `SendMessage` with 3 s timeout, `requestId` attached as a message attribute | Same contract for `claims.js` (retry, 202/503) |
| Worker consume (`worker.js`, new `sqsConsumer.js`) | `ch.consume` + prefetch + ack | N long-polling loops, **delete = ack**, backoff via visibility timeout | SQS has no ack/prefetch: these are the equivalents |
| Dead-letter queue | worker re-published to `claims.dlq` by hand | SQS **redrive policy** (`maxReceiveCount = 3`) does it | Less code, AWS-native |
| Health / dashboard | `rabbitmq` status, queue depth | `sqs` status, *In queue now* + *In flight* from `GetQueueAttributes` | Visible proof of buffering |
| Worker healthcheck | none | heartbeat file checked by Docker | `docker compose ps` can show `healthy` |
| Compose (`docker-compose.yml`) | local, ports 3000/8080/15672/27018 published | EC2 version: only **port 80** published; Mongo on **EBS bind mount**; logs to **CloudWatch** (`awslogs`) | Security (VPC SG), durability, observability |
| `docker-compose.local.yml` | - | laptop version that talks to the real SQS queue with lab credentials | Test before deploying |
| `.env.example`, env vars | - | `AWS_REGION`, `SQS_QUEUE_NAME`, rate-limit / worker knobs from `.env` | Demo tuning without editing YAML |
| `aws/` scripts | - | bootstrap, SQS setup, EBS mount, snapshot, monitoring (+SNS), S3 backup | Reproducible infrastructure |
| Load test | `k6-spike.js` on localhost | `BASE_URL` parameter, new `k6-burst.js` (`--vus 500 --duration 10s`) | Test against the Elastic IP |
| Docs | RabbitMQ wording | SQS / AWS wording, `docs/aws-deploy.md` | - |

**Unchanged on purpose:** the business logic (`claimProcessor.js`: atomic stock update, one confirmed claim per user, idempotent on `claimId`),
rate limiter, Redis cache, circuit breaker, catalog service, MongoDB schema, React app.

**Why SQS Standard is safe here:** Standard queues are *at-least-once* with *best-effort ordering*. The worker already ignores a repeated
`claimId` (unique index) and reserves stock with one atomic MongoDB update, so duplicates and reordering cannot oversell or double-charge.
A FIFO queue would give strict ordering per group but lower parallelism and is not needed for correctness.

**AWS services used:** EC2, SQS, EBS (+ snapshots), VPC / Security Group, Elastic IP, CloudWatch (Logs, metric filter, alarms),
IAM (instance profile), and optionally SNS (alarm e-mails) and S3 (database dump).

## Added for the full project requirements (CI/CD, costing, security, SLA)

| Item | What |
|---|---|
| `.github/workflows/ci-cd.yml`, `scripts/smoke-test.sh` | working CI/CD pipeline: static checks, security scan, build, deploy to EC2, health gate, smoke test, automatic rollback |
| `client/nginx.conf` | **security fix**: `X-Forwarded-For` is now overwritten with the real client address (before, a client could fake it and bypass the per-IP rate limiter); security headers added |
| `Dockerfile`s | gateway, worker and catalogue now run as the unprivileged `node` user instead of root |
| `aws/setup-monitoring.sh` | 7-day log retention, EC2 status-check and CPU alarms |
| `aws/snapshot-ebs.sh` | keeps the newest 7 snapshots (cost control) |
| `docs/cicd-design.md`, `cost-analysis.md`, `security.md`, `sla.md`, `requirements-mapping.md` | the written deliverables |
