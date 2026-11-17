#!/usr/bin/env bash
# End-to-end smoke test of a running FlashDeal deployment.
#   bash scripts/smoke-test.sh http://<ELASTIC-IP>
# Proves: gateway + Redis + MongoDB + SQS are UP, the catalogue is served, and a claim travels
# browser -> nginx -> gateway -> SQS -> worker -> MongoDB and comes back as a stored order.
# The test claim uses an UNKNOWN deal id: it is recorded as REJECTED/UNKNOWN_DEAL and never touches real stock.
set -euo pipefail
BASE="${1:?usage: smoke-test.sh <base-url, e.g. http://1.2.3.4>}"
BASE="${BASE%/}"
RUN="${GITHUB_RUN_ID:-$(date +%s)}"
USER_ID="ci-smoke-$RUN"
fail() { echo "SMOKE TEST FAILED: $1"; exit 1; }

echo "1/4 health"
health=$(curl -fsS -m 10 "$BASE/api/health") || fail "health endpoint unreachable"
echo "$health" | jq -e '.status == "UP" and .services.sqs == "UP" and .services.redis == "UP" and .services.mongodb == "UP"' >/dev/null \
  || fail "a dependency is not UP: $(echo "$health" | jq -c .services)"

echo "2/4 catalogue"
curl -fsS -m 10 "$BASE/api/deals?nocache=1" | jq -e '(.deals | length) > 0' >/dev/null || fail "no deals returned"

echo "3/4 claim accepted (HTTP 202)"
code=$(curl -s -m 10 -o /tmp/smoke-claim.json -w '%{http_code}' -X POST "$BASE/api/claim" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"$USER_ID\",\"dealId\":\"smoke-test\"}")
[ "$code" = "202" ] || fail "POST /api/claim returned $code (expected 202): $(cat /tmp/smoke-claim.json)"

echo "4/4 claim processed by the worker (SQS -> worker -> MongoDB)"
for i in $(seq 1 20); do
  status=$(curl -fsS -m 10 "$BASE/api/orders?userId=$USER_ID" | jq -r '(.orders // .)[0].status // empty' 2>/dev/null || true)
  if [ "$status" = "REJECTED" ]; then echo "OK: claim processed end to end after ~$((i*2))s"; exit 0; fi
  sleep 2
done
fail "claim was accepted but never processed within 40 s (worker or SQS problem)"
