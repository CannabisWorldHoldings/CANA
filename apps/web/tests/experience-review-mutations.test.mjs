import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as reviewModule from '../src/lib/experience-review-mutations.mjs';
import {
  ExperienceReviewMutationError,
  reviewExperienceCandidate,
} from '../src/lib/experience-review-mutations.mjs';

const TENANT = 'orderweeddc';
const CANDIDATE_ID = 'candidate-one';
const ACTOR = Object.freeze({
  authenticated: true,
  userId: 'admin-one',
  role: 'ADMIN',
});
const PAYLOAD_SHA = 'a'.repeat(64);
const EVIDENCE_REFS = Object.freeze([
  'sha256:' + 'b'.repeat(64),
  'sha256:' + 'c'.repeat(64),
]);
const EVIDENCE_SHA = createHash('sha256')
  .update(JSON.stringify(EVIDENCE_REFS))
  .digest('hex');

function candidate(overrides = {}) {
  return {
    id: CANDIDATE_ID,
    tenant: TENANT,
    version: 1,
    lifecycle: 'PENDING_REVIEW',
    payloadSha256: PAYLOAD_SHA,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    actor: ACTOR,
    tenant: TENANT,
    candidateId: CANDIDATE_ID,
    candidateVersion: 1,
    payloadSha256: PAYLOAD_SHA,
    decision: 'APPROVED_FOR_DRAFT_ONLY',
    reasonCode: 'OWNER_REVIEW_ACCEPTED',
    evidenceRefs: EVIDENCE_REFS,
    evidenceSha256: EVIDENCE_SHA,
    ...overrides,
  };
}

function createFakeDb(initialCandidate = candidate(), { failAudit = false } = {}) {
  let store = {
    candidates: initialCandidate ? [structuredClone(initialCandidate)] : [],
    receipts: [],
    audits: [],
  };
  let transactionTail = Promise.resolve();
  const isolationLevels = [];

  function delegates(draft) {
    return {
      experienceReviewCandidate: {
        async findUnique({ where }) {
          return structuredClone(
            draft.candidates.find((item) => item.id === where.id) ?? null,
          );
        },
        async updateMany({ where, data }) {
          const matches = draft.candidates.filter(
            (item) =>
              item.id === where.id &&
              item.tenant === where.tenant &&
              item.version === where.version &&
              item.lifecycle === where.lifecycle &&
              item.payloadSha256 === where.payloadSha256,
          );
          for (const item of matches) Object.assign(item, data);
          return { count: matches.length };
        },
      },
      experienceReviewReceipt: {
        async findFirst({ where, orderBy }) {
          assert.deepEqual(orderBy, { sequence: 'desc' });
          const matches = draft.receipts
            .filter((item) => item.candidateId === where.candidateId)
            .sort((left, right) => right.sequence - left.sequence);
          return structuredClone(matches[0] ?? null);
        },
        async create({ data }) {
          if (
            draft.receipts.some(
              (item) =>
                item.receiptHash === data.receiptHash ||
                (item.candidateId === data.candidateId &&
                  item.sequence === data.sequence),
            )
          ) {
            const error = new Error('Unique constraint failed.');
            error.code = 'P2002';
            throw error;
          }
          const receipt = { ...structuredClone(data), createdAt: new Date() };
          draft.receipts.push(receipt);
          return structuredClone(receipt);
        },
      },
      auditLog: {
        async create({ data }) {
          if (failAudit) throw new Error('Injected audit failure.');
          draft.audits.push({ id: `audit-${draft.audits.length + 1}`, ...data });
        },
      },
    };
  }

  return {
    $transaction(callback, options) {
      isolationLevels.push(options?.isolationLevel);
      const execute = transactionTail.then(async () => {
        const draft = structuredClone(store);
        const result = await callback(delegates(draft));
        store = draft;
        return result;
      });
      transactionTail = execute.catch(() => undefined);
      return execute;
    },
    snapshot() {
      return structuredClone(store);
    },
    get isolationLevels() {
      return [...isolationLevels];
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ExperienceReviewMutationError);
    assert.equal(error.code, code);
    return true;
  });
}

test('draft-only approval commits one CAS transition, false-authority receipt, and minimal audit atomically', async () => {
  const db = createFakeDb();

  const result = await reviewExperienceCandidate(db, request());
  const state = db.snapshot();

  assert.equal(result.outcome, 'COMMITTED');
  assert.equal(state.candidates[0].lifecycle, 'APPROVED_FOR_DRAFT_ONLY');
  assert.deepEqual(db.isolationLevels, ['Serializable']);
  assert.equal(state.receipts.length, 1);
  assert.deepEqual(
    {
      candidateId: state.receipts[0].candidateId,
      candidateVersion: state.receipts[0].candidateVersion,
      sequence: state.receipts[0].sequence,
      actorId: state.receipts[0].actorId,
      decision: state.receipts[0].decision,
      reasonCode: state.receipts[0].reasonCode,
      priorReceiptHash: state.receipts[0].priorReceiptHash,
      evidenceRefs: state.receipts[0].evidenceRefs,
      evidenceSha256: state.receipts[0].evidenceSha256,
      executionAuthorized: state.receipts[0].executionAuthorized,
      publishAuthorized: state.receipts[0].publishAuthorized,
      deploymentAuthorized: state.receipts[0].deploymentAuthorized,
    },
    {
      candidateId: CANDIDATE_ID,
      candidateVersion: 1,
      sequence: 1,
      actorId: 'admin-one',
      decision: 'APPROVED_FOR_DRAFT_ONLY',
      reasonCode: 'OWNER_REVIEW_ACCEPTED',
      priorReceiptHash: '0'.repeat(64),
      evidenceRefs: JSON.stringify(EVIDENCE_REFS),
      evidenceSha256: EVIDENCE_SHA,
      executionAuthorized: false,
      publishAuthorized: false,
      deploymentAuthorized: false,
    },
  );
  assert.match(state.receipts[0].receiptHash, /^[a-f0-9]{64}$/);
  assert.equal(state.receipts[0].id, `experience-review-${state.receipts[0].receiptHash}`);
  assert.deepEqual(state.audits, [
    {
      id: 'audit-1',
      userId: 'admin-one',
      action: 'REVIEW_EXPERIENCE_CANDIDATE_DRAFT_ONLY',
      details: `candidateId=${CANDIDATE_ID} receiptId=${state.receipts[0].id}`,
    },
  ]);
  assert.doesNotMatch(state.audits[0].details, /reason|evidence|payload|decision/i);
});

test('an exact replay is idempotent and returns the existing receipt', async () => {
  const db = createFakeDb();
  const committed = await reviewExperienceCandidate(db, request());
  const replayed = await reviewExperienceCandidate(db, request({
    evidenceRefs: [...EVIDENCE_REFS].reverse(),
    evidenceSha256: createHash('sha256')
      .update(JSON.stringify([...EVIDENCE_REFS].reverse()))
      .digest('hex'),
  }));

  assert.equal(replayed.outcome, 'REPLAYED');
  assert.equal(replayed.receipt.receiptHash, committed.receipt.receiptHash);
  assert.equal(db.snapshot().receipts.length, 1);
  assert.equal(db.snapshot().audits.length, 1);
});

test('concurrent exact requests create exactly one receipt and replay the same result', async () => {
  const db = createFakeDb();
  const results = await Promise.all([
    reviewExperienceCandidate(db, request()),
    reviewExperienceCandidate(db, request()),
  ]);

  assert.deepEqual(
    results.map((result) => result.outcome).sort(),
    ['COMMITTED', 'REPLAYED'],
  );
  assert.equal(new Set(results.map((result) => result.receipt.receiptHash)).size, 1);
  assert.equal(db.snapshot().receipts.length, 1);
  assert.equal(db.snapshot().audits.length, 1);
});

test('concurrent conflicting requests close once and refuse the loser', async () => {
  const db = createFakeDb();
  const results = await Promise.allSettled([
    reviewExperienceCandidate(db, request()),
    reviewExperienceCandidate(
      db,
      request({ decision: 'REJECTED', reasonCode: 'POLICY_REJECTED' }),
    ),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'REVIEW_ALREADY_DECIDED');
  assert.equal(db.snapshot().receipts.length, 1);
  assert.equal(db.snapshot().audits.length, 1);
});

test('stale version, payload tamper, foreign tenant, and unauthenticated actor refuse stable codes', async () => {
  await expectCode(
    reviewExperienceCandidate(createFakeDb(), request({ candidateVersion: 2 })),
    'REVIEW_STALE_VERSION',
  );
  await expectCode(
    reviewExperienceCandidate(
      createFakeDb(),
      request({ payloadSha256: 'd'.repeat(64) }),
    ),
    'REVIEW_PAYLOAD_TAMPERED',
  );
  await expectCode(
    reviewExperienceCandidate(createFakeDb(), request({ tenant: 'foreign' })),
    'REVIEW_FOREIGN_TENANT',
  );
  await expectCode(
    reviewExperienceCandidate(
      createFakeDb(),
      request({ actor: { ...ACTOR, authenticated: false } }),
    ),
    'REVIEW_UNAUTHENTICATED',
  );
  await expectCode(
    reviewExperienceCandidate(
      createFakeDb(),
      request({ actor: { ...ACTOR, role: 'MERCHANT' } }),
    ),
    'REVIEW_FORBIDDEN',
  );
});

test('invalid decisions, reason codes, hashes, and evidence fail before a transaction', async () => {
  const cases = [
    request({ decision: 'PUBLISH' }),
    request({ reasonCode: 'contains spaces' }),
    request({ payloadSha256: 'not-a-sha' }),
    request({ evidenceRefs: [] }),
    request({ evidenceRefs: ['https://raw-secret.example'] }),
    request({ evidenceSha256: 'e'.repeat(64) }),
  ];
  for (const invalid of cases) {
    const db = createFakeDb();
    await expectCode(reviewExperienceCandidate(db, invalid), 'REVIEW_INPUT_INVALID');
    assert.deepEqual(db.isolationLevels, []);
  }
});

test('audit failure rolls back candidate and receipt writes', async () => {
  const db = createFakeDb(candidate(), { failAudit: true });
  const before = db.snapshot();

  await assert.rejects(reviewExperienceCandidate(db, request()), /Injected audit failure/);
  assert.deepEqual(db.snapshot(), before);
});

test('rejected and returned-for-evidence are the only other closed transitions', async () => {
  for (const decision of ['REJECTED', 'RETURNED_FOR_EVIDENCE']) {
    const db = createFakeDb();
    const result = await reviewExperienceCandidate(
      db,
      request({ decision, reasonCode: `REVIEW_${decision}` }),
    );
    assert.equal(result.outcome, 'COMMITTED');
    assert.equal(db.snapshot().candidates[0].lifecycle, decision);
    assert.equal(db.snapshot().receipts[0].decision, decision);
  }
});

test('the review module exports no effect or authority-minting surface', () => {
  assert.deepEqual(Object.keys(reviewModule).sort(), [
    'ExperienceReviewMutationError',
    'reviewExperienceCandidate',
  ]);
  const source = readFileSync(
    new URL('../src/lib/experience-review-mutations.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /owner-gate|mintOwnerAuthorization|admitOwnerAuthorization|PUBLIC_CLAIM|\bDEPLOY\b/,
  );
});
