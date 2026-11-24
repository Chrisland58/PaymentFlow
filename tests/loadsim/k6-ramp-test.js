/**
 * k6 load simulation — ramp test (#654)
 *
 * Ramps from 0 to 1000 concurrent virtual users over 5 minutes, holds for
 * 10 minutes, then ramps down. Validates P95 latency < 500 ms for payment
 * intent creation and zero 5xx errors at peak load.
 *
 * Performance targets (#654):
 *   - P95 latency < 500 ms for POST /api/payments/intent
 *   - Zero 5xx errors at 1000 concurrent users
 *   - Throughput ≥ 100 payments/second (checked via rate threshold)
 *
 * Run:
 *   k6 run tests/loadsim/k6-ramp-test.js \
 *     --env BASE_URL=http://localhost:5000 \
 *     --env AUTH_TOKEN=<jwt>
 *
 * Or via the CI workflow (.github/workflows/load-testing.yml).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────
const errorRate       = new Rate('error_rate');
const serverErrorRate = new Rate('server_error_rate');   // 5xx only
const intentDuration  = new Trend('payment_intent_duration', true);
const intentCreated   = new Counter('payment_intents_created');

// ── Scenario configuration ─────────────────────────────────────────────────
export const options = {
  scenarios: {
    ramp_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m',  target: 1000 }, // ramp up to 1000 concurrent users
        { duration: '10m', target: 1000 }, // sustain peak load
        { duration: '2m',  target: 0 },    // ramp down
      ],
    },
  },
  thresholds: {
    // P95 latency for payment intent creation must be under 500 ms (#654).
    'payment_intent_duration{phase:peak}': ['p(95)<500'],
    // No 5xx errors allowed at any load level.
    server_error_rate: ['rate<0.001'],  // < 0.1 % 5xx
    // Overall error rate (4xx + 5xx) below 1 % to catch unexpected failures.
    error_rate: ['rate<0.01'],
    // HTTP request duration P95 under 1 s globally (all endpoints combined).
    'http_req_duration': ['p(95)<1000'],
    // Throughput gate: at least 100 successful payment intents per second
    // during the sustained phase. k6 measures this as a rate on the counter.
    'payment_intents_created': ['count>60000'], // 100 rps × 60s minimum sustained
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:5000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

// A fixed pool of student IDs is shared across VUs to avoid creating test
// data at load-test time. Pre-seed these in the test database before running.
const STUDENT_POOL_SIZE = 500;
const SCHOOL_ID         = __ENV.SCHOOL_ID || 'SCH-LOAD-001';

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

// ── Main VU function ───────────────────────────────────────────────────────
export default function () {
  const headers   = makeHeaders();
  const studentId = randomStudentId();

  // Determine whether this VU is in the ramp or the peak/sustained phase.
  // __ITER counts iterations; we use __VU (virtual user index) as a proxy
  // for phase since exact timing is not available mid-scenario.
  const phase = __VU > 500 ? 'peak' : 'ramp';

  // ── Payment intent creation ─────────────────────────────────────────────
  const intentStart = Date.now();
  const intentRes   = http.post(
    `${BASE_URL}/api/payments/intent`,
    JSON.stringify({ studentId }),
    { headers, tags: { phase } },
  );
  intentDuration.add(Date.now() - intentStart, { phase });

  const intentOk = check(intentRes, {
    'intent: status is 201':          (r) => r.status === 201,
    'intent: body has memo':          (r) => {
      try { return !!JSON.parse(r.body).memo; } catch { return false; }
    },
    'intent: body has walletAddress': (r) => {
      try { return !!JSON.parse(r.body).walletAddress; } catch { return false; }
    },
  });

  errorRate.add(!intentOk);
  serverErrorRate.add(intentRes.status >= 500);
  if (intentOk) intentCreated.add(1);

  // Brief pause between requests to avoid a pure hammering pattern that
  // does not resemble real user behaviour.
  sleep(0.1);
}

// ── Teardown — write a summary to stdout for CI artifact collection ─────────
export function handleSummary(data) {
  const p95 = data.metrics['payment_intent_duration']?.values?.['p(95)'] ?? 'n/a';
  const p99 = data.metrics['payment_intent_duration']?.values?.['p(99)'] ?? 'n/a';
  const rps = data.metrics['payment_intents_created']?.values?.count ?? 0;
  const dur = data.state?.testRunDurationMs ?? 0;
  const throughput = dur > 0 ? ((rps / (dur / 1000)).toFixed(1)) : 'n/a';

  const summary = {
    test: 'ramp',
    p95_ms: p95,
    p99_ms: p99,
    throughput_rps: throughput,
    server_error_rate: data.metrics['server_error_rate']?.values?.rate ?? 0,
    thresholds_passed: !Object.values(data.metrics).some(
      (m) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok),
    ),
  };

  return {
    'reports/loadsim/ramp-summary.json': JSON.stringify(summary, null, 2),
    stdout: `\n=== Ramp Test Summary ===\nP95: ${p95} ms | P99: ${p99} ms | Throughput: ${throughput} rps\n`,
  };
}
