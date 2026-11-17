# Cloud security concerns and controls

## 1. Shared responsibility

| AWS is responsible for (security **of** the cloud) | We are responsible for (security **in** the cloud) |
|---|---|
| data centres, hardware, hypervisor | guest OS patching on EC2, Docker, container images |
| SQS, CloudWatch, EBS, IAM service internals | Security Group rules, IAM permissions, SSH keys |
| physical durability of EBS and SQS storage | application code, input validation, rate limiting, secrets, backups |

## 2. Assets and attack surface

| Asset | Where | Exposed to |
|---|---|---|
| Web app + API (nginx :80) | EC2 via Elastic IP | the internet |
| SSH (:22) | EC2 | internet (CI deploys) or your IP |
| API gateway, Redis, MongoDB, catalogue | Docker network on EC2 | **not published**, reachable only from other containers |
| Claims data (user ids, orders) | MongoDB on EBS, SQS messages, CloudWatch Logs | AWS APIs, authorised by IAM |
| Credentials | instance profile (temporary, rotated by AWS), SSH key, GitHub secrets | |

## 3. Threats and controls

| # | Threat | Control in this project | Residual risk / future work |
|---|---|---|---|
| 1 | **Network exposure of internal services** (open Mongo / Redis) | Security Group allows only 22 and 80. In `docker-compose.yml` gateway, Redis, Mongo and catalogue have **no published ports** | Redis and MongoDB have no password (they are only on the private Docker network). Add auth for defence in depth |
| 2 | **Leaked cloud credentials** | no access keys in code, images, `.env` on EC2 or the pipeline; the SDK and the Docker log driver use the **IAM instance profile** (temporary credentials). `.env` is git-ignored | `LabRole` is broader than needed (Learner Lab does not allow custom roles). In a real account use a role limited to `sqs:SendMessage/ReceiveMessage/DeleteMessage/ChangeMessageVisibility/GetQueueAttributes/GetQueueUrl` on the one queue and `logs:CreateLogStream/PutLogEvents` |
| 3 | **Instance metadata theft** (SSRF -> credentials) | IMDSv2 only (session token required); hop limit 2 is the minimum that lets containers use the role | a vulnerable app container could still reach the metadata service: keep the hop limit at 2, never higher |
| 4 | **DoS / traffic flood / abuse** | Redis token bucket: 5 requests/s per client IP, burst 10, HTTP 429. nginx **overwrites** `X-Forwarded-For` with the real client address, so the limiter cannot be dodged by faking the header (this was a bug found during the security review and fixed in `client/nginx.conf`). Request body limited in Express. SQS absorbs bursts so the database is never overloaded | per-IP limiting does not stop a distributed attack: add AWS WAF / CloudFront / Shield in front of an ALB |
| 5 | **Overselling / data corruption under concurrency** | one atomic MongoDB update (`stock > 0`), unique index on `claimId` and one confirmed claim per user, idempotent worker; verified by `load-test/loadtest.js` (`noOverselling`) | |
| 6 | **Message loss** | SQS stores messages redundantly across AZs; message deleted only after the claim is saved; failed messages retried and then moved to the **dead-letter queue** (14-day retention) | |
| 7 | **Data at rest** | SQS encrypts messages at rest with SQS-managed keys (SSE-SQS, default for new queues: verify under the queue's *Encryption* tab). Tick **Encrypted** when you create the EBS data volume (default AWS-managed key); snapshots of an encrypted volume are encrypted too | the root volume and MongoDB itself are not encrypted at application level |
| 8 | **Data in transit** | calls to SQS, CloudWatch, S3 and EC2 APIs use HTTPS. SSH is key-only | **the public web app is plain HTTP**: a raw Elastic IP cannot get a trusted certificate. Fix: register a domain, then terminate TLS with an ALB + ACM certificate or Caddy / certbot on the instance; redirect 80 -> 443. Do not enter real personal data until then |
| 9 | **Unauthorised admin actions** | `/api/admin/*` and the Control room buttons (reset sale, break catalogue) are meant for the demo | **no authentication**: anyone who can reach port 80 can call them. Mitigation now: restrict port 80 to the faculty / college IP, or stop the stack after the demo. Fix: add an admin token / Cognito and remove the buttons in production |
| 10 | **Compromised container** | containers run as the unprivileged `node` user (not root), small Alpine base images, nginx hides its version and sends `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` | add `read_only: true`, `cap_drop: [ALL]` and `no-new-privileges` in compose; scan images with Trivy / ECR scanning |
| 11 | **Vulnerable dependencies / supply chain** | CI runs `npm audit` (fails on CRITICAL) and a Trivy scan; images are rebuilt on every deploy | pin and update dependencies with Dependabot; pin GitHub Actions to commit SHAs |
| 12 | **SSH brute force / stolen key** | key-only authentication (no passwords), key pair stored only on your laptop and as a GitHub secret | the CI deploy needs port 22 open to the internet. Use a self-hosted runner and close 22, or open it only during deployments (`docs/cicd-design.md`). Rotate the key if it is ever shared |
| 13 | **Unpatched operating system** | Ubuntu server images apply security updates automatically (`unattended-upgrades`); the `docker compose up --build` in each deployment pulls fresh base images | reboot after kernel updates; use AWS Systems Manager Patch Manager in a real account |
| 14 | **No audit trail / blind spots** | all container logs go to CloudWatch Logs with a `requestId` per request; metric filter + alarms for 429 spikes, queue backlog, EC2 status and CPU; AWS CloudTrail records API calls (event history) | add GuardDuty and Config in a real account (restricted in Learner Lab) |
| 15 | **Loss of data / disaster** | MongoDB data on EBS (survives container and instance restarts), EBS **snapshots**, optional **S3 dump**; documented restore in `docs/aws-deploy.md` (RPO / RTO in `docs/sla.md`) | single AZ: an AZ failure needs a restore from snapshot into another AZ |
| 16 | **Input attacks (injection, oversized input)** | `userId` and `dealId` are validated by pattern and length before use, MongoDB queries use parameters (no string building), JSON body size limit | add schema validation (e.g. a validation library) for every new endpoint |
| 17 | **Privacy** | the only personal data is a self-chosen user name; logs contain user ids and request ids but no passwords or payment data; CloudWatch retention is 7 days | define retention and deletion rules before collecting real customer data (GDPR / DPDP Act) |

## 4. Security checklist for the demo

- [ ] Security Group: only 22 and 80 inbound; nothing for 3000 / 6379 / 27017
- [ ] Instance: IAM instance profile attached, metadata version V2 only (token required), hop limit 2
- [ ] EBS data volume created with **Encrypted** ticked
- [ ] SQS queue shows encryption enabled; dead-letter queue exists
- [ ] `docker compose ps` shows no published ports except 80
- [ ] Port 22 limited to your IP (or open only during CI deploys)
- [ ] After the evaluation: stop the stack, release the Elastic IP, delete snapshots / volumes / queues
