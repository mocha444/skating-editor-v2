import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // ramp to 5
    { duration: '30s', target: 50 },  // ramp to 50
    { duration: '30s', target: 100 }, // peak
    { duration: '20s', target: 0 },   // ramp down
  ],
};

const BASE = 'https://pi-box.tailc45b4c.ts.net/skating';

export default function () {
  // 1. Page load
  const home = http.get(`${BASE}/`);
  check(home, {
    'home 200': (r) => r.status === 200,
    'home <3s': (r) => r.timings.duration < 3000,
  });

  // 2. Recent uploads API
  const recent = http.get(`${BASE}/api/recent`);
  check(recent, {
    'recent 200': (r) => r.status === 200,
  });

  // 3. Hash check (lightweight)
  const hash = http.get(`${BASE}/api/check-duplicate?hash=fake-hash-${__VU}-${__ITER}`);
  check(hash, {
    'hash 200': (r) => r.status === 200,
  });

  sleep(1);
}
