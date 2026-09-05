import { check } from 'k6';
import http from 'k6/http';

export const options = {
  vus: 5,
  duration: '30s',
};

export default function () {
  // Hit the main page
  const r1 = http.get('https://pi-box.tailc45b4c.ts.net/skating/');
  check(r1, { 'status 200': (r) => r.status === 200 });

  // Hit the progress endpoint (simulates polling)
  const r2 = http.get('https://pi-box.tailc45b4c.ts.net/skating/api/progress/test?jobId=test');
  check(r2, { 'poll responds': (r) => r.status === 200 || r.status === 404 });
}
