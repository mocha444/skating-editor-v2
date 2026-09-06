import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 25,
  duration: '2m',
  discardResponseBodies: true,
  thresholds: {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<5000'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const DIR = __ENV.DIR || 'skate-c82bef30';

export default function () {
  // 1. Home page
  const home = http.get(`${BASE}/`);
  check(home, { 'home 200': (r) => r.status === 200 });

  // 2. Recent list
  const recent = http.get(`${BASE}/api/recent`);
  check(recent, { 'recent 200': (r) => r.status === 200 });

  // 3. Trigger reprocess (simulates a "user" clicking the recent video)
  const fd = new FormData();
  fd.append('dir', DIR);
  fd.append('threshold', '0.003');
  fd.append('min-contour', '50');
  fd.append('min-motion-frames', '8');
  fd.append('buffer-frames', '60');
  fd.append('history', '300');
  fd.append('var-threshold', '25');
  fd.append('detect-shadows', 'false');

  const rep = http.post(`${BASE}/api/reprocess`, fd.body(), {
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + fd.boundary() },
  });
  check(rep, {
    'reprocess 200 or 409': (r) => r.status === 200 || r.status === 409,
  });

  // 4. Poll progress (each user checks their job)
  const j = rep.json();
  if (j && j.jobId) {
    const prog = http.get(`${BASE}/api/progress/${j.jobId}?jobId=${j.jobId}`);
    check(prog, { 'progress responds': (r) => r.status === 200 });
  }

  sleep(2);
}
