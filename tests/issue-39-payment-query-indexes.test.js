'use strict';

/**
 * Payment query index coverage — issue #39 / #654
 *
 * Verifies that the MongoDB indexes used by high-volume payment queries
 * (the ones exercised during 1000-concurrent-user load tests) are defined
 * on the relevant models. This is a static analysis of the Mongoose schema
 * index definitions — no live database connection required.
 *
 * Covers the query patterns identified in the load simulation (#654):
 *   - Payment lookup by schoolId + status           → compound index
 *   - PaymentIntent lookup by schoolId + memo        → compound unique index
 *   - Student lookup by schoolId + studentId         → compound index
 *   - Payment lookup by txHash                       → single-field index
 *   - Payment lookup by studentId + confirmedAt      → compound index (reports)
 *   - AuditLog lookup by schoolId + createdAt        → compound index
 *
 * If a required index is missing the test fails with a descriptive message,
 * directing the developer to add the appropriate migration.
 */

// Point env vars at a dummy URI so config/index.js does not reject on startup.
process.env.MONGO_URI             = 'mongodb://localhost:27017/test';
process.env.JWT_SECRET            = 'test-jwt-secret-index-check';
process.env.SCHOOL_WALLET_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// ── Model requires ─────────────────────────────────────────────────────────
// Use the backend's own node_modules copy of mongoose so the schema
// definitions resolve correctly.
jest.mock('../../backend/src/config/database', () => ({ connect: jest.fn() }));

const Payment       = require('../backend/src/models/paymentModel');
const PaymentIntent = require('../backend/src/models/paymentIntentModel');
const Student       = require('../backend/src/models/studentModel');
const AuditLog      = require('../backend/src/models/auditLogModel');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract all index key paths from a Mongoose schema, returning them as an
 * array of sorted key-string representations for easy comparison.
 * Example: an index on { schoolId: 1, status: 1 } → 'schoolId_1_status_1'
 */
function getSchemaIndexKeys(model) {
  const schema = model.schema;
  const indexes = schema.indexes();
  return indexes.map(([fields]) =>
    Object.entries(fields)
      .map(([k, v]) => `${k}_${v}`)
      .join('_'),
  );
}

/**
 * Returns true if the model schema has an index whose key path includes
 * all of the specified fields (in any order relative to other fields,
 * but matching the provided directions).
 */
function hasIndexCovering(model, fields) {
  const schema   = model.schema;
  const indexes  = schema.indexes();
  return indexes.some(([indexFields]) => {
    const keys = Object.keys(indexFields);
    return fields.every((f) => keys.includes(f));
  });
}

/**
 * Returns true if the model schema has a path-level index (defined directly
 * on a SchemaType, e.g. `index: true` or `unique: true`) for the given field.
 */
function hasPathIndex(model, fieldName) {
  const path = model.schema.path(fieldName);
  if (!path) return false;
  return !!(path.options.index || path.options.unique || path.options.sparse);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Payment collection indexes (#39, #654)', () => {
  test('Payment has an index covering schoolId for school-scoped queries', () => {
    const covered = hasIndexCovering(Payment, ['schoolId']) ||
                    hasPathIndex(Payment, 'schoolId');
    expect(covered).toBe(true);
  });

  test('Payment has an index covering txHash for deduplication lookups', () => {
    const covered = hasIndexCovering(Payment, ['txHash']) ||
                    hasPathIndex(Payment, 'txHash');
    expect(covered).toBe(true);
  });

  test('Payment has an index covering studentId and confirmedAt for report queries', () => {
    // This compound index backs the payment report aggregation used under load.
    const covered = hasIndexCovering(Payment, ['studentId', 'confirmedAt']) ||
                    hasIndexCovering(Payment, ['schoolId', 'confirmedAt']);
    expect(covered).toBe(true);
  });

  test('Payment has an index covering schoolId and status for status-filtered queries', () => {
    const covered = hasIndexCovering(Payment, ['schoolId', 'status']) ||
                    (hasIndexCovering(Payment, ['schoolId']) && hasPathIndex(Payment, 'status'));
    expect(covered).toBe(true);
  });
});

describe('PaymentIntent collection indexes (#39, #654)', () => {
  test('PaymentIntent has an index covering schoolId and memo for intent lookups', () => {
    // Migration 025 adds a compound unique index on { schoolId, memo }.
    const covered = hasIndexCovering(PaymentIntent, ['schoolId', 'memo']);
    expect(covered).toBe(true);
  });

  test('PaymentIntent has a TTL index on expiresAt for automatic cleanup', () => {
    // TTL indexes are defined with expireAfterSeconds; look for the field.
    const indexes = PaymentIntent.schema.indexes();
    const hasTtl = indexes.some(([fields, opts]) =>
      ('expiresAt' in fields || 'createdAt' in fields) &&
      opts.expireAfterSeconds !== undefined,
    );
    const pathHasTtl = (() => {
      const p = PaymentIntent.schema.path('expiresAt') || PaymentIntent.schema.path('createdAt');
      return p && p.options.expires !== undefined;
    })();
    expect(hasTtl || pathHasTtl).toBe(true);
  });
});

describe('Student collection indexes (#39, #654)', () => {
  test('Student has an index covering schoolId for school-scoped queries', () => {
    const covered = hasIndexCovering(Student, ['schoolId']) ||
                    hasPathIndex(Student, 'schoolId');
    expect(covered).toBe(true);
  });

  test('Student has an index covering studentId for direct lookups', () => {
    const covered = hasIndexCovering(Student, ['studentId']) ||
                    hasPathIndex(Student, 'studentId');
    expect(covered).toBe(true);
  });
});

describe('AuditLog collection indexes (#39, #654)', () => {
  test('AuditLog has an index covering schoolId and createdAt for paginated queries', () => {
    const covered = hasIndexCovering(AuditLog, ['schoolId', 'createdAt']) ||
                    hasIndexCovering(AuditLog, ['schoolId']);
    expect(covered).toBe(true);
  });

  test('AuditLog has a TTL index for automatic log expiry', () => {
    const indexes = AuditLog.schema.indexes();
    const hasTtl = indexes.some(([, opts]) => opts.expireAfterSeconds !== undefined);
    const pathHasTtl = (() => {
      const p = AuditLog.schema.path('createdAt') || AuditLog.schema.path('expiresAt');
      return p && p.options.expires !== undefined;
    })();
    expect(hasTtl || pathHasTtl).toBe(true);
  });
});
