import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EXPERIENCE_REVIEW_INBOX_MAX_PAGE,
  EXPERIENCE_REVIEW_INBOX_PAGE_SIZE,
  ExperienceReviewInboxError,
  buildExperienceReviewMutationInput,
  clampExperienceReviewPage,
  experienceReviewInboxHref,
  experienceReviewPageCount,
  experienceReviewPageOffset,
  parseExperienceReviewAction,
  parseExperienceReviewInboxSearch,
  projectExperienceReviewCandidate,
} from '../src/lib/experience-review-inbox.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function candidate(overrides = {}) {
  return {
    id: 'candidate-1',
    tenant: 'orderweeddc',
    siteId: 'site-dc',
    merchantId: null,
    sourceKind: 'SITEMIND',
    sourceArtifact: 'docs/evidence/site-intelligence/snapshot.json',
    sourceRevision: 'site-intelligence-v2',
    payloadSha256: DIGEST_A,
    evidenceRefs: JSON.stringify([
      { ref: 'docs/evidence/z.json', sha256: DIGEST_B },
      { ref: 'docs/evidence/a.json', sha256: DIGEST_A },
    ]),
    rightsState: 'NOT_APPLICABLE',
    accessibilityState: 'NOT_TESTED',
    policyState: 'PASS',
    uncertaintyState: 'BOUNDED',
    lifecycle: 'PENDING_REVIEW',
    version: 1,
    createdAt: new Date('2026-08-23T16:00:00.000Z'),
    updatedAt: new Date('2026-08-23T16:00:00.000Z'),
    receipts: [],
    rawPayload: 'must never project',
    ...overrides,
  };
}

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

test('inbox pages are bounded and preserve the independent pending and reviewed queues', () => {
  assert.equal(EXPERIENCE_REVIEW_INBOX_PAGE_SIZE, 12);
  assert.deepEqual(parseExperienceReviewInboxSearch({
    pendingPage: ['2', '99'],
    reviewedPage: '9999',
  }), {
    pendingPage: 2,
    reviewedPage: EXPERIENCE_REVIEW_INBOX_MAX_PAGE,
  });
  assert.equal(experienceReviewPageCount(13), 2);
  assert.equal(clampExperienceReviewPage(99, 13), 2);
  assert.equal(experienceReviewPageOffset(2), 12);
  assert.equal(
    experienceReviewInboxHref({ pendingPage: 2, reviewedPage: 3 }, 'pendingPage', 1),
    '/admin/experience-review?reviewedPage=3',
  );
  assert.throws(() => experienceReviewPageCount(-1), TypeError);
  assert.throws(() => experienceReviewInboxHref({}, 'otherPage', 2), TypeError);
});

test('projection exposes only bounded Owner-review fields and digest evidence', () => {
  const projected = projectExperienceReviewCandidate(candidate());
  assert.equal(projected.decisionEligible, true);
  assert.equal(projected.evidenceState, 'AVAILABLE');
  assert.deepEqual(projected.evidenceRefs.map(({ ref }) => ref), [
    'docs/evidence/a.json',
    'docs/evidence/z.json',
  ]);
  assert.equal(JSON.stringify(projected).includes('must never project'), false);
  assert.equal(Object.hasOwn(projected, 'rawPayload'), false);

  const unavailable = projectExperienceReviewCandidate(candidate({
    evidenceRefs: '{not-json',
  }));
  assert.equal(unavailable.evidenceState, 'CAPABILITY_GAP');
  assert.equal(unavailable.decisionEligible, false);
  assert.deepEqual(unavailable.evidenceRefs, []);
});

test('review action accepts only a canonical candidate identity, positive version, and draft-only decision vocabulary', () => {
  assert.deepEqual(parseExperienceReviewAction(form({
    candidateId: 'candidate-1',
    candidateVersion: '7',
    decision: 'APPROVED_FOR_DRAFT_ONLY',
  })), {
    candidateId: 'candidate-1',
    candidateVersion: 7,
    decision: 'APPROVED_FOR_DRAFT_ONLY',
  });
  for (const fields of [
    { candidateId: '../candidate', candidateVersion: '1', decision: 'REJECTED' },
    { candidateId: 'candidate-1', candidateVersion: '0', decision: 'REJECTED' },
    { candidateId: 'candidate-1', candidateVersion: '1', decision: 'PUBLISH' },
  ]) {
    assert.throws(
      () => parseExperienceReviewAction(form(fields)),
      (error) => error instanceof ExperienceReviewInboxError && error.code === 'INBOX_INPUT_INVALID',
    );
  }
});

test('mutation request takes payload and evidence from the database candidate, not browser fields', () => {
  const action = parseExperienceReviewAction(form({
    candidateId: 'candidate-1',
    candidateVersion: '1',
    decision: 'RETURNED_FOR_EVIDENCE',
    payloadSha256: 'f'.repeat(64),
    evidenceRefs: 'browser-controlled',
  }));
  const request = buildExperienceReviewMutationInput({
    candidate: candidate(),
    action,
    actor: { userId: 'admin-1', role: 'ADMIN' },
  });
  assert.equal(request.payloadSha256, DIGEST_A);
  assert.deepEqual(request.evidenceRefs, [`sha256:${DIGEST_A}`, `sha256:${DIGEST_B}`]);
  assert.equal(request.reasonCode, 'OWNER_EVIDENCE_REQUIRED');
  assert.deepEqual(request.actor, {
    authenticated: true,
    role: 'ADMIN',
    userId: 'admin-1',
  });
  assert.equal(JSON.stringify(request).includes('browser-controlled'), false);
  assert.throws(
    () => buildExperienceReviewMutationInput({
      candidate: candidate(), action, actor: { userId: 'user-1', role: 'CUSTOMER' },
    }),
    (error) => error instanceof ExperienceReviewInboxError && error.code === 'INBOX_AUTHORITY_REQUIRED',
  );
});

test('route re-authenticates before its minimal candidate read and exposes no publish or deploy action', () => {
  const source = fs.readFileSync(
    path.join(webRoot, 'src/app/admin/experience-review/page.tsx'),
    'utf8',
  );
  const actionStart = source.indexOf('async function settleExperienceReview');
  const actionSource = source.slice(actionStart, source.indexOf('\n  }', actionStart) + 4);
  assert.ok(actionSource.indexOf('await assertAdmin()') >= 0);
  assert.ok(actionSource.indexOf('await assertAdmin()') < actionSource.indexOf('findUnique'));
  assert.match(actionSource, /reviewExperienceCandidate\(prisma, request\)/);
  assert.doesNotMatch(actionSource, /formData\.get\(['"](?:payloadSha256|evidenceRefs|tenant)['"]\)/);
  assert.match(source, />\s*Approve for draft\s*</);
  assert.match(source, />\s*Reject\s*</);
  assert.match(source, />\s*Return for evidence\s*</);
  assert.doesNotMatch(source, /name="decision"\s+value="(?:PUBLISH|DEPLOY|PROMOTE|EXECUTE)"/);
});
