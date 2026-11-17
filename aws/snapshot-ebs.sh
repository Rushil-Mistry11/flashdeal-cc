#!/usr/bin/env bash
# Takes a point-in-time EBS snapshot of the MongoDB data volume.
#   bash aws/snapshot-ebs.sh                 (keeps the newest 7 snapshots; KEEP=14 to change). Finds the volume tagged Name=flashdeal-mongo-data on this instance)
#   bash aws/snapshot-ebs.sh vol-0123abcd    (or pass the volume id)
# MongoDB's journal makes a snapshot of the running database crash-consistent: it restores like a clean power cut.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
VOLUME_ID="${1:-}"

if [ -z "$VOLUME_ID" ]; then
  TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  IID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
  VOLUME_ID=$(aws ec2 describe-volumes --region "$REGION" \
    --filters "Name=attachment.instance-id,Values=$IID" "Name=tag:Name,Values=flashdeal-mongo-data" \
    --query 'Volumes[0].VolumeId' --output text)
fi
if [ -z "$VOLUME_ID" ] || [ "$VOLUME_ID" = "None" ]; then
  echo "No volume found. Tag the data volume Name=flashdeal-mongo-data or pass its volume id."; exit 1
fi

SNAP=$(aws ec2 create-snapshot --region "$REGION" --volume-id "$VOLUME_ID" \
  --description "flashdeal mongo $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=flashdeal-mongo-snapshot}]' \
  --query SnapshotId --output text)
echo "Snapshot $SNAP of $VOLUME_ID started, waiting for it to complete ..."
aws ec2 wait snapshot-completed --region "$REGION" --snapshot-ids "$SNAP"
echo "Snapshot $SNAP completed."

# Retention: keep only the newest KEEP snapshots (default 7) so storage cost stays flat.
KEEP="${KEEP:-7}"
mapfile -t ALL < <(aws ec2 describe-snapshots --region "$REGION" --owner-ids self \
  --filters "Name=tag:Name,Values=flashdeal-mongo-snapshot" \
  --query 'sort_by(Snapshots,&StartTime)[].SnapshotId' --output text | tr '\t' '\n')
if [ "${#ALL[@]}" -gt "$KEEP" ]; then
  for old in "${ALL[@]:0:${#ALL[@]}-KEEP}"; do
    echo "Deleting old snapshot $old"
    aws ec2 delete-snapshot --region "$REGION" --snapshot-id "$old"
  done
fi
