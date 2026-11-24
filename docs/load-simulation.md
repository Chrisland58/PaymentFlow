# Load Simulation Tests

PaymentFlow uses [k6](https://k6.io/) for load simulation. The scripts live in
`tests/loadsim/` and are run via `.github/workflows/load-testing.yml`.

## Scripts

| Script | Purpose | Trigger |
|--------|---------|---------|
| `k6-ramp-test.js` | 0 → 1000 VUs over 5 min, sustained 10 min | PRs touching payment code, manual |
| `k6-spike-test.js` | Instant 2000-VU spike for 30 s, then recovery | PRs touching payment code, manual |
| `k6-soak-test.js` | 500 VUs for 2 hours | Nightly at 02:00 UTC |
| `horizonPollLoadModel.js` | Discrete-event model for Horizon polling (#1124) | `npm run test:loadsim` |

## Performance targets (#654)

| Metric | Target |
|--------|--------|
| P95 latency (payment intent creation) | < 500 ms |
| 5xx error rate at 1000 concurrent users | 0 |
| Throughput | ≥ 100 payments/second |
| Spike recovery time (after 2000-VU burst) | < 30 s |

## Running locally

Install k6 (macOS: `brew install k6`; Linux: see [k6 docs](https://k6.io/docs/get-started/installation/)).

```bash
# Start the backend first
cd backend && npm run dev

# Ramp test (1000 VUs)
k6 run tests/loadsim/k6-ramp-test.js \
  --env BASE_URL=http://localhost:5000 \
  --env AUTH_TOKEN=<your-jwt>

# Spike test
k6 run tests/loadsim/k6-spike-test.js \
  --env BASE_URL=http://localhost:5000

# Soak test (2 h — run overnight)
k6 run tests/loadsim/k6-soak-test.js \
  --env BASE_URL=http://localhost:5000
```

Reports are written to `reports/loadsim/` as JSON summaries.

## Pre-seeding test data

The load scripts draw from a pool of 500 pre-seeded students under school
`SCH-LOAD-001`. Before running locally, seed that data:

```bash
node scripts/seed-loadsim-data.js
```

In CI this is done automatically by the workflow before k6 starts.

## Index coverage

`tests/issue-39-payment-query-indexes.test.js` verifies that the MongoDB
indexes required for high-volume query patterns are defined in the Mongoose
schemas. Run it with:

```bash
npx jest tests/issue-39-payment-query-indexes.test.js --forceExit
```

This test is included in the normal `npm test` run and in the CI
`index-coverage` job.
