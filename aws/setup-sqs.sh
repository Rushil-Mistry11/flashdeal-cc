#!/usr/bin/env bash
# Creates the SQS queue "flashdeal-claims" and its dead-letter queue "flashdeal-claims-dlq".
# Safe to run again (same settings = no change). Run on EC2 (instance profile) or anywhere the AWS CLI has Learner Lab credentials.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
QUEUE="${SQS_QUEUE_NAME:-flashdeal-claims}"
DLQ="${QUEUE}-dlq"

echo "Creating dead-letter queue $DLQ ..."
aws sqs create-queue --region "$REGION" --queue-name "$DLQ" \
  --attributes '{"MessageRetentionPeriod":"1209600"}' >/dev/null
DLQ_URL=$(aws sqs get-queue-url --region "$REGION" --queue-name "$DLQ" --query QueueUrl --output text)
DLQ_ARN=$(aws sqs get-queue-attributes --region "$REGION" --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

# VisibilityTimeout 30 s: time a worker has to finish a claim before SQS offers the message to someone else.
# maxReceiveCount 3 : after 3 failed deliveries SQS moves the message to the DLQ (same "3 attempts" rule as before).
ATTRS=$(jq -nc --arg arn "$DLQ_ARN" '{
  VisibilityTimeout: "30",
  ReceiveMessageWaitTimeSeconds: "20",
  RedrivePolicy: ({deadLetterTargetArn: $arn, maxReceiveCount: 3} | tostring)
}')

echo "Creating queue $QUEUE ..."
aws sqs create-queue --region "$REGION" --queue-name "$QUEUE" --attributes "$ATTRS" >/dev/null
QUEUE_URL=$(aws sqs get-queue-url --region "$REGION" --queue-name "$QUEUE" --query QueueUrl --output text)

echo
echo "Queue : $QUEUE_URL"
echo "DLQ   : $DLQ_URL"
echo "The app finds the queue by name ($QUEUE) so no URL needs to be configured."
