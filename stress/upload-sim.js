import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 3,
  duration: '60s',
  discardResponseBodies: true,
};

const BASE = 'https://pi-box.tailc45b4c.ts.net/skating';

export default function () {
  // Simulate concurrent uploads (just the upload POST endpoint, no real file)
  // Note: real upload testing requires actual file bytes
  const payload = JSON.stringify({
    hash: `stress-${__VU}-${Date.now()}`,
    threshold: '0.003',
    'min-contour': '50',
  });

  const res = http.post(`${BASE}/api/upload`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'upload responds': (r) => [200, 400, 413, 500].includes(r.status),
    'response <10s': (r) => r.timings.duration < 10000,
  });

  sleep(2);
}
