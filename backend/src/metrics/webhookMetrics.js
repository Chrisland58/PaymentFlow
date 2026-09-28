'use strict';

/**
 * webhookMetrics.js — Prometheus metrics for outbound webhook delivery.
 *
 * Exported metrics (all registered on the shared registry from metrics/index.js):
 *
 *   webhook_deliveries_total{event, outcome, status_class}
 *     Counter. Incremented after every delivery attempt.
 *     outcome:      'success' | 'failure'
 *     status_class: '2xx' | '4xx' | '5xx' | 'timeout' | 'ssrf_blocked' |
 *                   'redirect_blocked' | 'network_error' | 'unknown'
 *
 *   webhook_delivery_duration_ms{event, status_class}
 *     Histogram. Round-trip time in milliseconds for each delivery attempt.
 *
 *   webhook_dead_letter_total{schoolId}
 *     Gauge. Number of failed final deliveries (all retries exhausted) per school.
 *     Refreshed on startup and after each delivery write via refreshDeadLetterGauge().
 *
 *   webhook_retry_attempt_total{event, attempt_number}
 *     Counter. Incremented each time a retry attempt is made, labelled with
 *     the 1-based attempt number. Lets operators see the attempt-count
 *     distribution — e.g. how many deliveries succeed on attempt 2 vs 3.
 *
 *   webhook_pending_delivery_age_seconds
 *     Gauge. Age in seconds of the oldest pending webhook retry, refreshed on
 *     each Prometheus scrape. Operators alert when this exceeds the max backoff
 *     window, signalling a stale or stuck delivery.
 *
 *   webhook_deliveries_terminal_total{event, terminal_outcome}
 *     Counter. Incremented once when a delivery reaches a terminal state.
 *     terminal_outcome: 'succeeded' | 'dead_lettered' | 'permanent_error'
 */

const { registry } = require('./index');
const client = require('prom-client');

// ── webhook_deliveries_total ──────────────────────────────────────────────────
const webhookDeliveriesTotal = new client.Counter({
  name: 'webhook_deliveries_total',
  help: 'Total webhook delivery attempts by event type, outcome, and HTTP status class',
  labelNames: ['event', 'outcome', 'status_class'],
  registers: [registry],
});

// ── webhook_delivery_duration_ms ──────────────────────────────────────────────
const webhookDeliveryDurationMs = new client.Histogram({
  name: 'webhook_delivery_duration_ms',
  help: 'Webhook delivery round-trip time in milliseconds',
  labelNames: ['event', 'status_class'],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

// ── webhook_dead_letter_total ─────────────────────────────────────────────────
// Gauge instead of counter so it can go down when retries succeed or records
// are cleaned up by TTL expiry.
const webhookDeadLetterTotal = new client.Gauge({
  name: 'webhook_dead_letter_total',
  help: 'Number of webhook deliveries that exhausted all retries, per school',
  labelNames: ['schoolId'],
  registers: [registry],
});

// ── webhook_retry_attempt_total ───────────────────────────────────────────────
// attempt_number is a string label (1-indexed attempt: '1', '2', '3', …).
// Cardinality is bounded by WEBHOOK_MAX_ATTEMPTS (default 3).
const webhookRetryAttemptTotal = new client.Counter({
  name: 'webhook_retry_attempt_total',
  help: 'Total webhook retry attempts by event and attempt number (1-indexed)',
  labelNames: ['event', 'attempt_number'],
  registers: [registry],
});

// ── webhook_pending_delivery_age_seconds ─────────────────────────────────────
// Refreshed on each scrape via collect(). Returns 0 when no pending retries exist.
new client.Gauge({
  name: 'webhook_pending_delivery_age_seconds',
  help: 'Age in seconds of the oldest pending webhook retry record (0 = none pending)',
  registers: [registry],
  async collect() {
    try {
      const WebhookRetry = require('../models/webhookRetryModel');
      const oldest = await WebhookRetry.findOne({ status: 'pending' })
        .sort({ createdAt: 1 })
        .select('createdAt')
        .lean();
      this.set(oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000) : 0);
    } catch (_) {
      // DB may not be ready yet — scrape still succeeds with last-known value
    }
  },
});

// ── webhook_deliveries_terminal_total ────────────────────────────────────────
const webhookDeliveriesTerminalTotal = new client.Counter({
  name: 'webhook_deliveries_terminal_total',
  help: 'Total webhook deliveries that reached a terminal state',
  labelNames: ['event', 'terminal_outcome'],
  registers: [registry],
});

// ── Status-class classification ───────────────────────────────────────────────
/**
 * Derive a Prometheus-safe status_class label from an HTTP status code or
 * an error string.
 *
 * @param {number|null} statusCode
 * @param {string|null} [errorMessage]
 * @returns {string}  '2xx' | '4xx' | '5xx' | 'redirect_blocked' |
 *                    'timeout' | 'ssrf_blocked' | 'network_error' | 'unknown'
 */
function classifyStatus(statusCode, errorMessage = null) {
  if (statusCode !== null && statusCode !== undefined) {
    if (statusCode >= 200 && statusCode < 300) return '2xx';
    if (statusCode >= 300 && statusCode < 400) return 'redirect_blocked';
    if (statusCode >= 400 && statusCode < 500) return '4xx';
    if (statusCode >= 500)                     return '5xx';
  }
  if (errorMessage) {
    const msg = String(errorMessage).toUpperCase();
    if (msg.startsWith('SSRF_BLOCKED') || msg.startsWith('SSRF_REDIRECT_BLOCKED') || msg === 'URL_VALIDATION_FAILED') return 'ssrf_blocked';
    if (msg.includes('TIMEOUT') || msg.includes('ECONNABORTED'))                                                      return 'timeout';
    if (msg.startsWith('REPLAY_DETECTED'))                                                                             return 'replay_blocked';
  }
  return 'network_error';
}

/**
 * Refresh the webhook_dead_letter_total gauge by querying the WebhookDelivery
 * collection. Called on startup and after each delivery that hits max retries.
 *
 * @returns {Promise<void>}
 */
async function refreshDeadLetterGauge() {
  try {
    const WebhookDelivery = require('../models/webhookDeliveryModel');
    const MAX_ATTEMPTS = parseInt(process.env.WEBHOOK_MAX_ATTEMPTS, 10) || 3;

    const counts = await WebhookDelivery.aggregate([
      { $match: { success: false, attemptCount: { $gte: MAX_ATTEMPTS } } },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } },
    ]);

    webhookDeadLetterTotal.reset();
    for (const { _id, count } of counts) {
      if (_id) webhookDeadLetterTotal.set({ schoolId: _id }, count);
    }
  } catch (_) {
    // DB may not be ready yet — scrape still succeeds with last-known values
  }
}

/**
 * Record a successful delivery.
 *
 * @param {string} event       Webhook event type (e.g. 'payment.confirmed')
 * @param {number} durationMs  Round-trip time in ms
 * @param {number} [statusCode] HTTP status code (optional, defaults to 200)
 */
function recordDeliverySuccess(event, durationMs, statusCode = 200) {
  const statusClass = classifyStatus(statusCode);
  webhookDeliveriesTotal.inc({ event, outcome: 'success', status_class: statusClass });
  webhookDeliveryDurationMs.observe({ event, status_class: statusClass }, durationMs);
}

/**
 * Record a failed delivery attempt.
 *
 * @param {string}  event        Webhook event type
 * @param {number}  durationMs   Round-trip time in ms
 * @param {boolean} [isDeadLetter=false]  True when all retries have been exhausted
 * @param {string}  [schoolId]   Required when isDeadLetter is true
 * @param {number|null} [statusCode]  HTTP status code if available
 * @param {string|null} [errorMessage]  Error string for non-HTTP failures
 */
function recordDeliveryFailure(event, durationMs, isDeadLetter = false, schoolId = null, statusCode = null, errorMessage = null) {
  const statusClass = classifyStatus(statusCode, errorMessage);
  webhookDeliveriesTotal.inc({ event, outcome: 'failure', status_class: statusClass });
  webhookDeliveryDurationMs.observe({ event, status_class: statusClass }, durationMs);

  if (isDeadLetter && schoolId) {
    webhookDeadLetterTotal.inc({ schoolId });
  }
}

/**
 * Record a retry attempt.
 *
 * @param {string} event         Webhook event type
 * @param {number} attemptNumber 1-based attempt number
 */
function recordRetryAttempt(event, attemptNumber) {
  webhookRetryAttemptTotal.inc({ event, attempt_number: String(attemptNumber) });
}

/**
 * Record a terminal delivery outcome.
 *
 * @param {string} event           Webhook event type
 * @param {string} terminalOutcome 'succeeded' | 'dead_lettered' | 'permanent_error'
 */
function recordTerminalOutcome(event, terminalOutcome) {
  webhookDeliveriesTerminalTotal.inc({ event, terminal_outcome: terminalOutcome });
}

module.exports = {
  webhookDeliveriesTotal,
  webhookDeliveryDurationMs,
  webhookDeadLetterTotal,
  webhookRetryAttemptTotal,
  webhookDeliveriesTerminalTotal,
  refreshDeadLetterGauge,
  recordDeliverySuccess,
  recordDeliveryFailure,
  recordRetryAttempt,
  recordTerminalOutcome,
  classifyStatus,
};
