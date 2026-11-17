// k6 spike test.   k6 run -e BASE_URL=http://<ELASTIC-IP> load-test/k6-spike.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '5s', target: 10 },
    { duration: '10s', target: 100 }, // spike
    { duration: '5s', target: 0 },
  ],
};

export default function () {
  const res = http.post(`${BASE}/api/claim`, JSON.stringify({ userId: `k6-${__VU}-${__ITER}`, dealId: 'deal-001' }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'accepted or throttled': (r) => r.status === 202 || r.status === 429 });
}
