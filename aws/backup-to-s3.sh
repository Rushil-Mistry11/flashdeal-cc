#!/usr/bin/env bash
# Optional second backup layer: logical dump of the database to an S3 bucket.
#   cd ~/flashdeal-cc && bash aws/backup-to-s3.sh my-unique-bucket-name
# Restore later with:  aws s3 cp s3://<bucket>/backups/<file> - | docker compose exec -T mongo mongorestore --archive --gzip --drop
set -euo pipefail
BUCKET="${1:?usage: backup-to-s3.sh <globally-unique-bucket-name>}"
REGION="${AWS_REGION:-us-east-1}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/tmp/flashdeal-$STAMP.archive.gz"

aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || aws s3 mb "s3://$BUCKET" --region "$REGION"
docker compose exec -T mongo mongodump --db flashdeal --archive --gzip > "$FILE"
aws s3 cp "$FILE" "s3://$BUCKET/backups/flashdeal-$STAMP.archive.gz" --region "$REGION"
rm -f "$FILE"
echo "Backup uploaded: s3://$BUCKET/backups/flashdeal-$STAMP.archive.gz"
