/**
 * EVALUATOR IMMUNE SYSTEM — sabotage certification for the provenance court.
 *
 * Before the court is trusted, the court itself goes on trial: we present it
 * deliberately corrupted chains, one tampering class at a time. The court
 * MUST turn RED on every one. IF A FALSE CHAIN STAYS GREEN, THE EVALUATOR
 * FAILS CERTIFICATION — that is the entire point of this file.
 *
 * Run: node --test tools/provenance-court/sabotage.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyChain } from './verify-chain.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const NOW = new Date('2026-08-09T17:00:00Z');

/** A fully intact chain: every link carries the same exact identity. */
function intactChain() {
  return {
    sourceSha: SHA_A,
    receipt: { gitSha: SHA_A, builtAt: '2026-08-09T16:00:00Z', artifact: `orderweeddc-${SHA_A.slice(0, 7)}.tar.gz` },
    release: { state: 'RELEASE_SHA_PRESENT', gitSha: SHA_A },
    surfaceHtml: `<!doctype html><html><head><meta name="cana-release-sha" content="${SHA_A}"/></head><body>ok</body></html>`,
    now: NOW,
  };
}

test('CONTROL: the intact chain is GREEN (otherwise every RED below is vacuous)', () => {
  const { verdict, links } = verifyChain(intactChain());
  assert.equal(verdict, 'GREEN', JSON.stringify(links, null, 2));
  assert.equal(links.length, 4);
  for (const l of links) assert.equal(l.status, 'GREEN', `${l.name}: ${l.why}`);
});

const SABOTAGES = [
  {
    name: 'S1 artifact built from a different commit than claimed source',
    corrupt: (c) => { c.receipt.gitSha = SHA_B; },
    redLink: 'ARTIFACT',
  },
  {
    name: 'S2 source identity is a short SHA (inexact treatment identity)',
    corrupt: (c) => { c.sourceSha = SHA_A.slice(0, 12); },
    redLink: 'SOURCE',
  },
  {
    name: 'S3 build receipt deleted (artifact with no identity)',
    corrupt: (c) => { c.receipt = null; },
    redLink: 'ARTIFACT',
  },
  {
    name: 'S4 deployment cannot state its release (RELEASE_SHA_MISSING)',
    corrupt: (c) => { c.release = { state: 'RELEASE_SHA_MISSING', gitSha: null }; },
    redLink: 'RELEASE',
  },
  {
    name: 'S5 active release swapped under the same receipt',
    corrupt: (c) => { c.release.gitSha = SHA_B; },
    redLink: 'RELEASE',
  },
  {
    name: 'S6 rendered surface served by a different release than announced',
    corrupt: (c) => {
      c.surfaceHtml = c.surfaceHtml.replace(SHA_A, SHA_B);
    },
    redLink: 'SURFACE',
  },
  {
    name: 'S7 rendered surface carries no identity at all',
    corrupt: (c) => {
      c.surfaceHtml = '<!doctype html><html><head></head><body>ok</body></html>';
    },
    redLink: 'SURFACE',
  },
  {
    name: 'S8 future-dated build receipt (clock-forged provenance)',
    corrupt: (c) => { c.receipt.builtAt = '2027-01-01T00:00:00Z'; },
    redLink: 'ARTIFACT',
  },
];

for (const sabotage of SABOTAGES) {
  test(`SABOTAGE ${sabotage.name} -> court MUST turn RED`, () => {
    const chain = intactChain();
    sabotage.corrupt(chain);
    const { verdict, links } = verifyChain(chain);
    assert.equal(
      verdict,
      'RED',
      `EVALUATOR FAILS CERTIFICATION: corrupted chain stayed GREEN.\n${JSON.stringify(links, null, 2)}`,
    );
    const failed = links.find((l) => l.name === sabotage.redLink);
    assert.equal(failed?.status, 'RED', `expected ${sabotage.redLink} to be the RED link: ${JSON.stringify(links)}`);
  });
}

test('CERTIFICATION SUMMARY: every sabotage class is detected', () => {
  let detected = 0;
  for (const sabotage of SABOTAGES) {
    const chain = intactChain();
    sabotage.corrupt(chain);
    if (verifyChain(chain).verdict === 'RED') detected += 1;
  }
  assert.equal(detected, SABOTAGES.length, `sensitivity ${detected}/${SABOTAGES.length} — must be total`);
});

test('FAIL-CLOSED: an empty evidence bundle is RED on every link, not an error', () => {
  const { verdict, links } = verifyChain({ now: NOW });
  assert.equal(verdict, 'RED');
  for (const l of links) assert.equal(l.status, 'RED', `${l.name} must be RED when evidence is absent`);
});
