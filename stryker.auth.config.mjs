// @ts-check
/**
 * Stryker mutation testing configuration — auth and payment service modules (#650)
 *
 * Covers:
 *   backend/src/services/   — payment processing, Stellar integration, auth-adjacent logic
 *   backend/src/middleware/  — auth enforcement, rate limiting, request validation
 *
 * Run locally:
 *   npx stryker run stryker.auth.config.mjs
 *
 * CI uses this config in .github/workflows/mutation-testing.yml, triggered on
 * PRs that touch backend/src/services/** or backend/src/middleware/**.
 *
 * Mutation score threshold: 70% (target 80% by sprint+2).
 * Use --concurrency to parallelise mutant execution and stay under 10 minutes.
 */

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress', 'json'],
  testRunner: 'jest',
  jest: {
    // Use the root jest config so stryker inherits the same module resolution,
    // transform, and setup files that the normal test run uses.
    configFile: 'package.json',
    projectType: 'custom',
    // Restrict to tests that exercise auth and payment service code so the
    // mutation run stays focused and fast.
    enableFindRelatedTests: true,
  },
  // Mutate only the auth and payment service modules called out in #650.
  mutate: [
    'backend/src/services/stellarService.js',
    'backend/src/services/paymentConfirmationStateMachine.js',
    'backend/src/services/paymentLimitsService.js',
    'backend/src/services/paymentSavedSubscribers.js',
    'backend/src/services/receiptService.js',
    'backend/src/services/auditService.js',
    'backend/src/services/idempotencyStore.js',
    'backend/src/middleware/auth.js',
    'backend/src/middleware/rateLimiter.js',
    'backend/src/middleware/validate.js',
    'backend/src/middleware/schoolContext.js',
    'backend/src/middleware/idempotency.js',
    // Exclude generated/config-only files — they carry no mutatable logic.
    '!backend/src/services/email/**',
    '!backend/src/middleware/schemas/**',
  ],
  // Parallelism: keep total wall-clock time under 10 minutes (#650 AC).
  // 4 concurrent workers is a safe default for a 2-core CI runner; set
  // STRYKER_CONCURRENCY in the environment to override.
  concurrency: parseInt(process.env.STRYKER_CONCURRENCY || '4', 10),
  // Quality gate: fail the run when the mutation score drops below 70%.
  // This is enforced as a CI gate; surviving mutants above the threshold
  // must be triaged (killed by new tests or documented as acceptable).
  thresholds: {
    high: 80,
    low: 70,
    break: 70,
  },
  // JSON report is consumed by the CI step that posts a PR comment with the
  // mutation score delta vs the base branch.
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  // Stryker's incremental mode caches results between runs. The cache is
  // committed to .stryker-tmp/ which is gitignored — it only speeds up
  // local re-runs, not CI (CI always starts clean).
  incremental: false,
  // Log only warnings and above in CI; use 'debug' locally when diagnosing.
  logLevel: process.env.CI ? 'warn' : 'info',
  tempDirName: '.stryker-tmp',
  // Keep the sandbox inside the workspace so relative module paths resolve.
  symlinkNodeModules: true,
};

export default config;
