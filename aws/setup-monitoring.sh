#!/usr/bin/env bash
# CloudWatch extras (run AFTER the containers have started once, so the log group exists):
#   1. metric filter: counts "rate_limited" log lines (HTTP 429) as a custom metric FlashDeal/RateLimited429
#   2. alarm: SQS queue backlog > 100 messages
#   3. alarm: more than 50 throttled requests in a minute
#   3b. alarms: EC2 status check failed, EC2 CPU > 80% for 10 minutes (needs the instance id: read from the metadata service)
#   3c. log retention 7 days (keeps CloudWatch storage cost near zero)
#   4. (optional) SNS email notifications:   ALERT_EMAIL=you@example.com bash aws/setup-monitoring.sh
#      -> AWS sends a confirmation email, click the link in it.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
LOG_GROUP="${CW_LOG_GROUP:-/aws/ec2/flashdeal-logs}"
QUEUE="${SQS_QUEUE_NAME:-flashdeal-claims}"

if ! aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$LOG_GROUP" \
     --query 'logGroups[].logGroupName' --output text | grep -q "$LOG_GROUP"; then
  echo "Log group $LOG_GROUP does not exist yet. Start the stack first (docker compose up -d) and run this again."; exit 1
fi

ACTION=()
if [ -n "${ALERT_EMAIL:-}" ]; then
  TOPIC_ARN=$(aws sns create-topic --region "$REGION" --name flashdeal-alerts --query TopicArn --output text)
  aws sns subscribe --region "$REGION" --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL" >/dev/null
  ACTION=(--alarm-actions "$TOPIC_ARN")
  echo "SNS topic flashdeal-alerts created. Confirm the subscription from the email sent to $ALERT_EMAIL"
fi

aws logs put-metric-filter --region "$REGION" --log-group-name "$LOG_GROUP" \
  --filter-name flashdeal-rate-limited --filter-pattern '{ $.msg = "rate_limited" }' \
  --metric-transformations metricName=RateLimited429,metricNamespace=FlashDeal,metricValue=1,defaultValue=0

aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name flashdeal-queue-backlog \
  --namespace AWS/SQS --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions "Name=QueueName,Value=$QUEUE" \
  --statistic Maximum --period 60 --evaluation-periods 1 --threshold 100 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching "${ACTION[@]}"

aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name flashdeal-high-429 \
  --namespace FlashDeal --metric-name RateLimited429 \
  --statistic Sum --period 60 --evaluation-periods 1 --threshold 50 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching "${ACTION[@]}"

aws logs put-retention-policy --region "$REGION" --log-group-name "$LOG_GROUP" --retention-in-days 7

TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60" || true)
IID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id || true)
if [ -n "$IID" ]; then
  aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name flashdeal-ec2-status-check \
    --namespace AWS/EC2 --metric-name StatusCheckFailed --dimensions "Name=InstanceId,Value=$IID" \
    --statistic Maximum --period 60 --evaluation-periods 2 --threshold 0 \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching "${ACTION[@]}"
  aws cloudwatch put-metric-alarm --region "$REGION" --alarm-name flashdeal-ec2-cpu-high \
    --namespace AWS/EC2 --metric-name CPUUtilization --dimensions "Name=InstanceId,Value=$IID" \
    --statistic Average --period 300 --evaluation-periods 2 --threshold 80 \
    --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching "${ACTION[@]}"
else
  echo "Could not read the instance id (not on EC2?): skipped the EC2 alarms."
fi

echo "Done: metric filter, 7-day log retention and alarms (queue backlog, 429 rate, EC2 status check, EC2 CPU)."
