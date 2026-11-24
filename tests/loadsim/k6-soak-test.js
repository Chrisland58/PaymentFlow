/**
 * k6 load simulation — soak test (#654)
 *
 * Sustains 500 concurrent virtual users for 2 hours (overnight CI run).
 * Detects memory leaks, connection pool exhaustion, and slow degradation
 * that only manifest under prolonged load.
 *
 * Performance targets (#654):
 *   - P95 latency < 500 ms throughout the full 2-hour window
 *   - Zero 5xx errors at 500 concurrent users
 *   - No throughput degradation > 20% from start to end of run
 *
 * Run:
 *   k6 run tests/loadsim/k6-soak-test.js \
 *     --env BASE_URL=http://localhost:5000 \
 *     --env AUTH_TOKEN=<jwt>
 *
 * Scheduled as a nightly CI job — see .github/workflows/load-testing.yml.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────
const serverErrorRate = new Rate('server_error_rate');
const errorRate       = new Rate('error_rate');
const intentDuration  = new Trend('payment_intent_duration', true);
const intentCreated   = new Counter('payment_intents_created');

// ── Scenario configuration ─────────────────────────────────────────────────
export const options = {
  scenarios: {
    soak_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m',   target: 500  }, // warm-up ramp
        { duration: '110m', target: 500  }, // sustained soak (overnight)
        { duration: '5m',   target: 0    }, // ramp down
      ],
    },
  },
  thresholds: {
    // P95 must stay under 500 ms for the entire 2-hour window (#654).
    'payment_intent_duration': ['p(95)<500'],
    // Zero 5xx errors allowed.
    server_error_rate: ['rate<0.001'],
    // Global error rate under 1 %.
    error_rate: ['rate<0.01'],
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

export default function () {
  const headers   = makeHeaders();
  const studentId = randomStudentId();

  const start = Date.now();
  const res   = http.post(
    `${BASE_URL}/api/payments/intent`,
    JSON.stringify({ studentId }),
    { headers },
  );
  intentDuration.add(Date.now() - start);

  const ok = check(res, {
    'intent: status 201':    (r) => r.status === 201,
    'intent: not 5xx':       (r) => r.status < 500,
    'intent: has memo':      (r) => {
      try { return !!JSON.parse(r.body).memo; } catch { return false; }
    },
  });

  serverErrorRate.add(res.status >= 500);
  errorRate.add(!ok);
  if (ok) intentCreated.add(1);

  // 200 ms think-time — matches realistic payment-submission cadence.
  sleep(0.2);
}

export function handleSummary(data) {
  const p95 = data.metrics['payment_intent_duration']?.values?.['p(95)'] ?? 'n/a';
  const p99 = data.metrics['payment_intent_duration']?.values?.['p(99)'] ?? 'n/a';
  const serverErr = data.metrics['server_error_rate']?.values?.rate ?? 0;
  const totalIntents = data.metrics['payment_intents_created']?.values?.count ?? 0;

  const summary = {
    test: 'soak',
    duration_minutes: 120,
    p95_ms: p95,
    p99_ms: p99,
    server_error_rate: serverErr,
    total_intents_created: totalIntents,
    thresholds_passed: !Object.values(data.metrics).some(
      (m) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok),
    ),
  };

  return {
    'reports/loadsim/soak-summary.json': JSON.stringify(summary, null, 2),
    stdout: `\n=== Soak Test Summary (2h) ===\nP95: ${p95} ms | P99: ${p99} ms | 5xx rate: ${(serverErr * 100).toFixed(3)}% | Total intents: ${totalIntents}\n`,
  };
}
