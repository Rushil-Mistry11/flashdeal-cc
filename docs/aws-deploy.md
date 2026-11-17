# Deploying FlashDeal on AWS Learner Lab (step by step) and verifying it

Everything below uses the **us-east-1** region (Learner Lab only allows us-east-1 and us-west-2).
Replace `<EIP>` with your Elastic IP.

## 1. Start the lab and create the network rules (VPC Security Group)

1. Learner Lab > **Start Lab**, wait for the green dot, open **AWS**.
2. EC2 > Security Groups > **Create security group** `flashdeal-sg` (default VPC):
   - Inbound **22 (SSH)** from *My IP*
   - Inbound **80 (HTTP)** from *Anywhere-IPv4* (or only your college / own IP: the demo has unauthenticated admin buttons)
   - For the CI/CD pipeline (section 8) port 22 must be reachable from GitHub: see the security note there
   - Do **not** open 3000, 6379, 27017: Gateway, Redis and MongoDB stay private on the Docker network.

## 2. Launch the EC2 instance (compute + IAM role + EBS volumes)

EC2 > **Launch instance**:

| Setting | Value |
|---|---|
| Name | `flashdeal` |
| AMI | Ubuntu Server 24.04 LTS (x86_64) |
| Type | `t3.small` (2 GB RAM; use `t3.medium` if the client build is slow) |
| Key pair | `vockey` (the Learner Lab key, `labsuser.pem`) |
| Security group | `flashdeal-sg` |
| Storage | Volume 1 (root): 20 GiB gp3. **Add new volume**: 8 GiB gp3, device `/dev/sdb`, **Encrypted: Yes** (this is the MongoDB data disk) |
| Advanced > IAM instance profile | **LabInstanceProfile** |
| Advanced > Metadata version | **V2 only (token required)** |
| Advanced > Metadata response hop limit | **2** (needed so containers can read the instance-profile credentials) |

Learner Lab does not allow creating IAM roles, so the pre-made `LabInstanceProfile` (role `LabRole`) is the IAM role.
It gives the instance access to SQS, CloudWatch, EBS snapshots, SNS and S3 **without any access key in the code**.

After launch:
- EC2 > Elastic Block Store > **Volumes**: find the 8 GiB volume attached to the instance and add the tag `Name = flashdeal-mongo-data`.
- EC2 > **Elastic IPs** > Allocate Elastic IP address > Actions > **Associate** with the `flashdeal` instance.

## 3. Copy the project and prepare the server

```bash
scp -i labsuser.pem flashdeal-cc.zip ubuntu@<EIP>:~
ssh -i labsuser.pem ubuntu@<EIP>

sudo apt-get install -y unzip && unzip flashdeal-cc.zip && cd flashdeal-cc
bash aws/ec2-bootstrap.sh          # Docker, Compose, AWS CLI
exit                               # log out and SSH back in (docker group), then: cd flashdeal-cc
```

Check that containers can reach the instance-profile credentials (must print `200`):

```bash
docker run --rm curlimages/curl -s -m 3 -o /dev/null -w "%{http_code}\n" -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60"
```

If it prints `000`, the hop limit is 1. Fix it (or relaunch with hop limit 2):

```bash
aws ec2 modify-instance-metadata-options --region us-east-1 --http-put-response-hop-limit 2 --http-endpoint enabled \
  --instance-id $(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/instance-id)
```

## 4. Mount the EBS data volume, create the SQS queues, start the stack

```bash
lsblk                                   # the new 8G disk, usually nvme1n1
sudo bash aws/mount-ebs.sh /dev/nvme1n1 # formats it (first time only) and mounts /mnt/mongo-data
bash aws/setup-sqs.sh                   # SQS queue flashdeal-claims + DLQ flashdeal-claims-dlq (redrive after 3 attempts)
cp .env.example .env                    # leave the AWS_* credential lines empty on EC2
docker compose up -d --build
docker compose ps
```

Open `http://<EIP>` (the React app) and `http://<EIP>/api/health`.
Optional extras: `ALERT_EMAIL=you@example.com bash aws/setup-monitoring.sh` (CloudWatch metric, alarms, 7-day log retention, SNS e-mail) and `bash aws/backup-to-s3.sh <unique-bucket-name>`.

Daily EBS snapshot (RPO of the SLA), keeps the newest 7:
```bash
(crontab -l 2>/dev/null; echo '0 2 * * * cd $HOME/flashdeal-cc && bash aws/snapshot-ebs.sh >> $HOME/snapshot.log 2>&1') | crontab -
```

## 5. The four demo tests

### Test 1: containers run on EC2
```bash
docker compose ps
```
Expected: `api-gateway`, `worker`, `redis`, `mongo`, `catalog-service`, `client` show `Up ... (healthy)`.
`migrate` shows `Exited (0)`: it is a one-shot job that creates the schema and seeds the catalogue.
Also: `curl -s http://<EIP>/api/health` shows `redis`, `mongodb`, `sqs`, `catalogService` all `UP`.

### Test 2: throttling and SQS buffering (k6 from your laptop)

**2a. Rate limiter (default settings, 5 req/s per IP):**
```bash
k6 run -e BASE_URL=http://<EIP> --vus 500 --duration 10s load-test/k6-burst.js
```
Expected: mostly `429` (token bucket per IP), a small number of `202`, no `5xx`. Counters on the app's Control room: *Rate limited* grows.

**2b. SQS absorbing a real burst.** One laptop is one IP, so raise the limit and slow the worker down for one run (on EC2):
```bash
RATE_LIMIT_CAPACITY=1000 RATE_LIMIT_REFILL_PER_SEC=1000 PROCESSING_MS_MIN=1500 PROCESSING_MS_MAX=2500 \
  docker compose up -d api-gateway worker
k6 run -e BASE_URL=http://<EIP> --vus 200 --duration 10s load-test/k6-burst.js
```
Expected: almost all `202`. The Control room tile **In queue now** (and **In flight**) climbs, and in the console
SQS > `flashdeal-claims` > *Messages available* shows the backlog (the Monitoring graphs lag by a few minutes).
Then it drains as the worker saves the claims. Go back to defaults with `docker compose up -d api-gateway worker`.

**Correctness check** (no overselling), from your laptop (Node 18+):
```bash
node load-test/loadtest.js --base http://<EIP> --target claim --total 500 --concurrency 50 --reset true
```
Expected: `stockCheck.noOverselling = true`. Sold-out shoppers are **not** an HTTP error: they get `202` and the worker records the claim as
`SOLD_OUT` in MongoDB (visible in *My orders*). The unit reservation is one atomic MongoDB update, so stock can never go negative.

### Test 3: centralized logs in CloudWatch
Console > CloudWatch > **Log groups** > `/aws/ec2/flashdeal-logs`: one log stream per container (`flashdeal-api-gateway-1`, `flashdeal-worker-1`, ...).
In **Logs Insights** (select the log group):
```
fields @timestamp, @logStream, msg, status, requestId
| filter msg in ["http_request", "rate_limited", "claim_confirmed", "claim_sold_out"]
| sort @timestamp desc
| limit 50
```
Count throttled requests per minute: `filter msg = "rate_limited" | stats count() by bin(1m)`.
With `aws/setup-monitoring.sh` you also get the custom metric **FlashDeal > RateLimited429** and two alarms (queue backlog, high 429 rate).

### Test 4: EBS durability, snapshot and restore
```bash
docker compose exec mongo mongosh flashdeal --quiet --eval 'db.claims.countDocuments()'     # claims on the EBS disk
df -h /mnt/mongo-data                                                                        # the data really lives on the EBS volume
bash aws/snapshot-ebs.sh                                                                     # point-in-time snapshot (or Console > Snapshots > Create)
```
Durability: `docker compose down && docker compose up -d`: the claim count is unchanged (data is on EBS, not in the container).

Restore demo: EC2 > Snapshots > select it > Actions > **Create volume from snapshot** (same AZ as the instance) > attach it to the instance as `/dev/sdc`, then:
```bash
lsblk                                         # new disk, e.g. nvme2n1
sudo mkdir -p /mnt/restore && sudo mount -o ro /dev/nvme2n1 /mnt/restore
ls /mnt/restore/db                            # the MongoDB files as they were at snapshot time
```

### Bonus: dead-letter queue
```bash
FAIL_RATE=1 docker compose up -d worker       # every claim fails
curl -s -X POST http://<EIP>/api/claim -H "Content-Type: application/json" -d '{"userId":"dlq-test","dealId":"deal-001"}'
```
Worker logs show `claim_retry_scheduled` twice and then `claim_failed_moving_to_dlq`; within about 30 s the message is in
SQS > `flashdeal-claims-dlq` (poll for messages to see it). Restore with `docker compose up -d worker`.

## 6. Day-to-day with Learner Lab

- When the lab session ends, the instance stops. Start the lab again, start the instance: the Elastic IP stays, `/mnt/mongo-data` is remounted
  from `/etc/fstab`, and the containers restart on their own (`restart: unless-stopped`). No credentials to renew on EC2.
- Developing on your laptop? Use `docker-compose.local.yml` (see its header): it talks to the same SQS queue using the temporary lab credentials in `.env`.
- Save credits: stop the instance when you are not working. When the project is finished, release the Elastic IP, delete the snapshots and the extra volume, and delete the SQS queues.

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker compose up` fails with "failed to initialize logging driver" | Instance has no instance profile (attach `LabInstanceProfile`: Actions > Security > Modify IAM role) |
| Health shows `sqs: DOWN`, gateway logs `sqs_connect_retry` | Queue not created (`bash aws/setup-sqs.sh`), wrong region, or hop limit 1 (see step 3) |
| Worker logs `sqs_receive_error` | Same as above; or lab session expired |
| Mongo container restarts, permission denied | Volume not mounted or wrong owner: `sudo bash aws/mount-ebs.sh /dev/nvme1n1`, then `ls -ld /mnt/mongo-data/db` should show uid 999 |
| Site not reachable on `http://<EIP>` | Security group missing port 80, or the Elastic IP is not associated |
| `docker compose logs` shows nothing for a service | Logs go to CloudWatch; Docker 20.10+ also keeps a local copy so `docker compose logs` normally works. Otherwise use the console |

## 8. CI/CD pipeline

The repository contains a GitHub Actions pipeline (`.github/workflows/ci-cd.yml`): static checks, security scan and image build on every pull request; on a merge to `main` it also deploys to this EC2 instance, checks health, runs a smoke test through SQS and rolls back automatically on failure.
Set it up with the steps in `docs/cicd-design.md` (GitHub repository, three secrets `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, Security Group port 22).

## 9. Other project documents

`docs/cost-analysis.md` (costing), `docs/security.md` (cloud security), `docs/sla.md` (SLA), `docs/requirements-mapping.md` (where each project requirement is covered).
