// Constant-load burst for the Cloud Computing demo. Virtual users and duration come from the command line:
//   k6 run -e BASE_URL=http://<ELASTIC-IP> --vus 500 --duration 10s load-test/k6-burst.js
// Every iteration is a different shopper (userId), so the one-claim-per-user rule does not hide anything.
// Expected: 202 (accepted -> message in SQS) and 429 (per-IP token bucket). 5xx should stay at zero.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const DEAL = __ENV.DEAL_ID || 'deal-001';

export default function () {
  const res = http.post(`${BASE}/api/claim`, JSON.stringify({ userId: `k6-${__VU}-${__ITER}`, dealId: DEAL }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, {
    'accepted (202) or throttled (429)': (r) => r.status === 202 || r.status === 429,
  });
}
