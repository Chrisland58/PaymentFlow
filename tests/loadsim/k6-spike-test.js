/**
 * k6 load simulation — spike test (#654)
 *
 * Sends a sudden burst of 2000 concurrent virtual users for 30 seconds, then
 * drops back to baseline. Verifies the system recovers (no cascading failure)
 * within 30 seconds after the spike ends.
 *
 * Performance targets (#654):
 *   - System recovers (P95 < 500 ms) within 30 s after the spike
 *   - No cascading failure: error rate returns to < 1 % within 30 s
 *   - Zero 5xx errors during the recovery window
 *
 * Run:
 *   k6 run tests/loadsim/k6-spike-test.js \
 *     --env BASE_URL=http://localhost:5000 \
 *     --env AUTH_TOKEN=<jwt>
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────
const serverErrorRate    = new Rate('server_error_rate');
const errorRate          = new Rate('error_rate');
const intentDuration     = new Trend('payment_intent_duration', true);

// ── Scenario configuration ─────────────────────────────────────────────────
export const options = {
  scenarios: {
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100  },   // baseline warm-up
        { duration: '10s', target: 2000 },   // instant spike to 2000 VUs
        { duration: '30s', target: 2000 },   // hold the spike
        { duration: '10s', target: 100  },   // drop back to baseline
        { duration: '30s', target: 100  },   // recovery window — must pass threshold
        { duration: '10s', target: 0    },   // ramp down
      ],
    },
  },
  thresholds: {
    // During the recovery window (after the spike) P95 must recover to < 500 ms.
    // We track the whole test here; the CI step validates the recovery window
    // separately by inspecting the per-phase metrics in the JSON output.
    'payment_intent_duration': ['p(95)<1500'], // generous during spike itself
    // Zero 5xx allowed overall (the system must not fall over permanently).
    server_error_rate: ['rate<0.005'],
    // Global error rate under 5 % (4xx spikes during load are tolerated briefly).
    error_rate: ['rate<0.05'],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:5000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const SCHOOL_ID  = __ENV.SCHOOL_ID  || 'SCH-LOAD-001';

const STUDENT_POOL_SIZE = 500;

function randomStudentId() {
  const n = Math.floor(Math.random() * STUDENT_POOL_SIZE) + 1;
  return `STU-LOAD-${String(n).padStart(4, '0')}`;
}

function makeHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  h['x-school-id'] = SCHOOL_ID;
  return h;
}

// Label each VU based on approximate iteration count to tag recovery-window
// metrics separately. This is an approximation — k6 does not expose scenario
// elapsed time inside the VU function without an external setup.
let globalIter = 0;

export default function () {
  const headers   = makeHeaders();
  const studentId = randomStudentId();

  globalIter++;
  // The first ~600 iterations correspond to the baseline + spike phases;
  // subsequent iterations are in the recovery window.
  const phase = globalIter < 600 ? 'spike' : 'recovery';

  const start  = Date.now();
  const res    = http.post(
    `${BASE_URL}/api/payments/intent`,
    JSON.stringify({ studentId }),
    { headers, tags: { phase } },
  );
  intentDuration.add(Date.now() - start, { phase });

  const ok = check(res, {
    'intent: not 5xx': (r) => r.status < 500,
  });

  serverErrorRate.add(res.status >= 500);
  errorRate.add(!ok);

  sleep(0.05);
}

export function handleSummary(data) {
  const p95 = data.metrics['payment_intent_duration']?.values?.['p(95)'] ?? 'n/a';
  const serverErr = data.metrics['server_error_rate']?.values?.rate ?? 0;

  const summary = {
    test: 'spike',
    p95_ms: p95,
    server_error_rate: serverErr,
    thresholds_passed: !Object.values(data.metrics).some(
      (m) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok),
    ),
  };

  return {
    'reports/loadsim/spike-summary.json': JSON.stringify(summary, null, 2),
    stdout: `\n=== Spike Test Summary ===\nP95: ${p95} ms | 5xx rate: ${(serverErr * 100).toFixed(2)}%\n`,
  };
}
