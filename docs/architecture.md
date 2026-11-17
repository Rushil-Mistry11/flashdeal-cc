# Architecture and data flow (AWS deployment)

Mermaid renders on GitHub and at https://mermaid.live (export PNG/SVG for the submission).

## AWS infrastructure

```mermaid
flowchart LR
  U[Browser / k6 load test] --> EIP[Elastic IP]
  EIP --> SG{{VPC Security Group<br/>22 SSH, 80 HTTP only}}
  subgraph EC2[EC2 instance, Ubuntu + Docker Compose]
    N[nginx :80<br/>React app + /api proxy] --> G[API Gateway<br/>Express]
    G -->|token bucket, cache, counters| R[(Redis)]
    G -->|breaker + retry| C[Catalog service]
    C --> D[(MongoDB)]
    W[Worker pool<br/>Node, scalable] -->|reserve stock + save claim| D
    W -->|counters| R
    G -->|health, my orders| D
  end
  SG --> N
  G -->|SendMessage| Q[[AWS SQS<br/>flashdeal-claims]]
  Q -->|long-poll ReceiveMessage<br/>DeleteMessage| W
  Q -. 3 failed deliveries .-> DLQ[[SQS DLQ<br/>flashdeal-claims-dlq]]
  D --- EBS[(EBS volume<br/>/mnt/mongo-data)]
  EBS -. snapshot .-> SNAP[(EBS snapshot)]
  EC2 -->|awslogs driver| CW[CloudWatch Logs + metrics + alarms]
  IAM[IAM instance profile<br/>LabInstanceProfile] -. keyless access .-> EC2
  Q -. queue metrics .-> CW
```

## Data flow: POST /api/claim

```mermaid
sequenceDiagram
  participant C as Client
  participant G as Gateway
  participant R as Redis
  participant Q as AWS SQS
  participant W as Worker
  participant D as MongoDB (EBS)
  C->>G: POST /api/claim {userId, dealId}
  G->>R: tokenBucket(ip)
  alt no token
    G-->>C: 429 Too Many Requests
  else token available
    G->>Q: SendMessage (stored durably by SQS)
    G-->>C: 202 Accepted (claimId, requestId)
    W->>Q: ReceiveMessage (long poll)
    Q-->>W: claim (visible to this worker only for 30 s)
    W->>D: already confirmed for this user and deal?
    W->>D: atomic: stock-1 only if stock > 0 and sale open
    alt unit reserved
      W->>D: insert CONFIRMED claim (price, order number)
    else no stock
      W->>D: insert SOLD_OUT claim
    end
    W->>R: INCR counters
    W->>Q: DeleteMessage (= ack)
    C->>G: GET /api/orders (polling)
    G->>D: read claims
    G-->>C: Confirmed / Sold out
  end
```

If the worker fails, it skips `DeleteMessage`: the message becomes visible again after a backoff, and after 3 failed
deliveries SQS moves it to the dead-letter queue.

## Data flow: GET /api/deals

```mermaid
flowchart TD
  A[Request] --> B{Rate limit ok?}
  B -- no --> X[429]
  B -- yes --> C{Redis cache hit?}
  C -- yes --> H[200, X-Cache: HIT]
  C -- no --> D{Circuit open?}
  D -- yes --> S
  D -- no --> E[Call catalog service<br/>retry with backoff]
  E -- ok --> F[Cache 3s + save stale copy<br/>200, X-Cache: MISS]
  E -- fails --> S{Stale copy exists?}
  S -- yes --> T[200, X-Cache: STALE]
  S -- no --> U[503]
```

## Request tracing

Every request gets a `requestId` (header `X-Request-Id`, also saved on the claim, shown in the order receipt and attached to the
SQS message as a message attribute). Each log line is JSON with `service`, `stage` and `requestId`:

`gateway` -> `rate-limiter` -> `gateway->queue` -> `queue->worker` -> `worker->mongodb`

On AWS, trace one request in **CloudWatch Logs Insights** (log group `/aws/ec2/flashdeal-logs`):

```
fields @timestamp, @logStream, @message
| filter @message like /<requestId>/
| sort @timestamp asc
```
