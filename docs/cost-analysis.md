# Cost analysis (AWS us-east-1)

Prices checked November 2026 against public AWS price lists. They change, so confirm with the **AWS Pricing Calculator** before submitting
(the line items below are what to enter there). In Learner Lab the cost is deducted from the lab's credit budget (shown in the Learner Lab page), not charged to a card.

## Unit prices used

| Item | Price |
|---|---|
| EC2 `t3.small` (2 vCPU, 2 GiB), Linux | $0.0208 / hour ($15.18 / 730 h month) |
| EC2 `t3.medium` (2 vCPU, 4 GiB), Linux | $0.0416 / hour ($30.37 / 730 h month) |
| EBS gp3 volume | $0.08 / GB-month (3,000 IOPS and 125 MB/s included) |
| EBS snapshot | $0.05 / GB-month (incremental: only changed blocks are billed) |
| Public IPv4 / Elastic IP | $0.005 / hour = $3.65 / month, **attached or idle** (since Feb 2024) |
| SQS Standard | first 1 million requests / month free, then $0.40 per million (every Send, Receive, Delete, ChangeVisibility, GetQueueAttributes is a request) |
| CloudWatch Logs | $0.50 / GB ingested (first 5 GB / month free), $0.03 / GB-month stored |
| CloudWatch alarms / custom metrics | alarms $0.10 each (10 free), custom metrics $0.30 each (10 free) |
| SNS e-mail | first 1,000 e-mail deliveries / month free |
| Data transfer out to internet | first 100 GB / month free, then about $0.09 / GB |
| S3 Standard (database dump, optional) | about $0.023 / GB-month |

## Resources in this project

| Resource | Size |
|---|---|
| 1 x EC2 `t3.small` | runs 6 containers (nginx, gateway, worker, catalogue, Redis, MongoDB) |
| EBS root volume | 20 GB gp3 |
| EBS data volume (MongoDB) | 8 GB gp3 |
| EBS snapshots | up to 8 GB stored |
| 1 x Elastic IP | |
| SQS | queue + dead-letter queue |
| CloudWatch | 1 log group (7-day retention), 1 metric filter / custom metric, 4 alarms |

## Scenario A: course project (what you will actually spend)

The instance runs only when you work or demo (60 hours in the month); the volumes and the Elastic IP exist all month.

| Line item | Calculation | Monthly cost |
|---|---|---|
| EC2 t3.small | 60 h x $0.0208 | $1.25 |
| EBS gp3 | 28 GB x $0.08 | $2.24 |
| EBS snapshots | up to 8 GB x $0.05 | $0.40 |
| Elastic IP | 730 h x $0.005 | $3.65 |
| SQS | about 66 thousand requests (idle polling + test traffic), inside the free 1 M | $0.00 |
| CloudWatch (logs, alarms, metric) | under the free tier | $0.00 |
| SNS, S3 backup | free tier / a few cents | about $0.00 |
| **Total** | | **about $7.50** |

The two biggest items are the Elastic IP and the always-present EBS volumes, not compute. Release the Elastic IP and delete volumes and snapshots after the evaluation.

## Scenario B: always-on small production (24 x 7)

| Line item | Calculation | Monthly cost |
|---|---|---|
| EC2 t3.small | 730 h x $0.0208 | $15.18 |
| EBS gp3 | 28 GB x $0.08 | $2.24 |
| EBS snapshots | weekly, about 8 GB stored x $0.05 | $0.40 |
| Elastic IP | 730 h x $0.005 | $3.65 |
| SQS | idle long polling: 5 loops x 3 requests/min x 43,800 min = 657 k, plus 100 k claims x 3 requests = 300 k, about 957 k: inside the free 1 M | $0.00 |
| CloudWatch | under 1 GB logs, 4 alarms | $0.00 |
| **Total** | | **about $21.50** |

## Scenario C: growth (10 million claims a month, two web hosts, three workers)

| Line item | Calculation | Monthly cost |
|---|---|---|
| EC2 2 x t3.medium | 2 x 730 h x $0.0416 | $60.74 |
| SQS | 10 M claims x 3 requests + idle polling of 3 workers (about 2 M) = 32 M, minus 1 M free = 31 M x $0.40 | $12.40 |
| CloudWatch Logs | about 20 GB ingested, minus 5 GB free = 15 GB x $0.50 (7-day retention, storage negligible) | $7.50 |
| EBS gp3 | 2 x 20 GB root + 50 GB data = 90 GB x $0.08 | $7.20 |
| EBS snapshots | 50 GB x $0.05 (upper bound) | $2.50 |
| Public IPv4 | 2 x 730 h x $0.005 | $7.30 |
| **Subtotal** | | **about $98** |
| Not included | Application Load Balancer (needed for two hosts), managed database instead of MongoDB-in-a-container, data transfer above 100 GB | check the Pricing Calculator |

That is roughly **$10 per million claims** for the messaging + compute part. SQS grows linearly with traffic; the EC2 cost is fixed until you must add hosts.

## Why SQS instead of the RabbitMQ container (cost view)

- RabbitMQ needs memory and CPU on the same instance (and its own patching and monitoring). SQS is billed per request and the first 1 M requests a month are free, so for this project it costs $0.
- At 10 M claims a month SQS costs about $12; a broker that survives a host failure (clustered RabbitMQ or Amazon MQ) would cost many times more.
- Cost trap that we avoided: **short polling**. Workers use long polling (20 s), so an idle worker makes only 3 requests per minute per loop instead of hundreds. This is why idle cost stays inside the free tier.

## Cost-saving measures (already in the project or recommended)

| Measure | Saving |
|---|---|
| Stop the EC2 instance when not in use (only EBS + Elastic IP keep billing) | compute cost drops to the hours used |
| Release the Elastic IP and delete snapshots / volumes when finished | removes the fixed $3.65 + EBS charges |
| gp3 instead of gp2 | 20 % cheaper storage ($0.08 vs $0.10 per GB-month) |
| Log retention 7 days (set by `aws/setup-monitoring.sh`) | keeps CloudWatch storage near zero |
| SQS long polling (`WaitTimeSeconds=20`) and `MaxNumberOfMessages` batching | fewer billable requests |
| Right-sizing: t3.small is enough for the demo load; scale to t3.medium only when CPU alarm fires | avoids paying for idle capacity |
| 1-year Savings Plan / Reserved Instance for a real always-on service (about 28 % cheaper for t3.small) | $15.18 -> about $10.95 / month |
| Spot instances for extra workers (the queue makes workers safe to interrupt: unprocessed messages simply reappear) | up to about 60 % cheaper compute for the worker pool |
| Budget alarm on the account (AWS Budgets) | early warning; not always available in Learner Lab |

## How to measure the real cost

- Learner Lab shows the credits used on its start page. After a session note the amount before and after.
- If Cost Explorer is available: filter by service (EC2, EBS, VPC / public IPv4, SQS, CloudWatch).
- Put the line items above into the AWS Pricing Calculator and attach the exported estimate to the report.
