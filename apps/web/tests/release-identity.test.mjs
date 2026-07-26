import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  resolveReleaseIdentity, compareRelease, RELEASE_SHA_SOURCES,
} from '../src/lib/release-identity.mjs';

/**
 * RELEASE IDENTITY COURT.
 *
 * The question this exists to answer is "is the server running the code I think it
 * is?" — and this project has been misled by the wrong answer twice. A verifier
 * removed a guard, re-ran the suite without rebuilding, saw green, and reported a
 * coverage defect that did not exist. Next serves compiled bytes; an un-rebuilt
 * change is invisible.
 *
 * So the tests below care less about the happy path than about the two dishonest
 * failure modes: fabricating an identity, and reporting "no match" when the truthful
 * answer is "cannot tell".
 */

const SHA = 'a8c82beb0521bb4b0252f388c007bb490aff6435';

test('a valid sha from any supported source resolves as KNOWN', () => {
  for (const key of RELEASE_SHA_SOURCES) {
    const r = resolveReleaseIdentity({ [key]: SHA });
    assert.equal(r.state, 'KNOWN', `${key} should be honoured`);
    assert.equal(r.sha, SHA);
    assert.equal(r.short, SHA.slice(0, 7));
    assert.equal(r.source, key, 'the source must be named, so an operator can find where it came from');
  }
});

test('sources are honoured in PRIORITY order', () => {
  // Our own deploy variable must win over a platform-injected one, or a redeploy of
  // the same artifact could report the wrong commit.
  const other = 'b'.repeat(40);
  const r = resolveReleaseIdentity({ CANA_RELEASE_SHA: SHA, VERCEL_GIT_COMMIT_SHA: other });
  assert.equal(r.sha, SHA);
  assert.equal(r.source, 'CANA_RELEASE_SHA');
});

test('THE CORE RULE: an absent sha reports UNKNOWN and is never fabricated', () => {
  const r = resolveReleaseIdentity({});
  assert.equal(r.state, 'UNKNOWN');
  assert.equal(r.sha, null, 'no sha may be invented');
  assert.equal(r.short, null);
  // The detail must tell an operator how to fix it, not just that it is missing.
  assert.match(r.detail, /cannot be matched to a commit/i);
  for (const key of RELEASE_SHA_SOURCES) {
    assert.ok(r.detail.includes(key), `the remedy must name ${key}`);
  }
});

test('a MALFORMED sha is distinguished from an absent one', () => {
  // These need different fixes: one is a broken pipeline, the other is an
  // unconfigured one. Collapsing them sends an operator looking in the wrong place.
  for (const bad of ['main', 'HEAD', 'not-a-sha', SHA.slice(0, 12), `${SHA}extra`, '   x   ']) {
    const r = resolveReleaseIdentity({ CANA_RELEASE_SHA: bad });
    assert.equal(r.state, 'MALFORMED', `${JSON.stringify(bad)} must be MALFORMED, not silently ignored`);
    assert.equal(r.sha, null);
    assert.match(r.detail, /misconfigured/i);
  }
});

test('whitespace and case are normalised, not rejected', () => {
  const r = resolveReleaseIdentity({ CANA_RELEASE_SHA: `  ${SHA.toUpperCase()}  ` });
  assert.equal(r.state, 'KNOWN');
  assert.equal(r.sha, SHA, 'a sha is a sha regardless of case or surrounding space');
});

test('an empty or blank variable is treated as ABSENT, not malformed', () => {
  for (const v of ['', '   ', undefined]) {
    assert.equal(resolveReleaseIdentity({ CANA_RELEASE_SHA: v }).state, 'UNKNOWN');
  }
});

// ------------------------------------------------------------------ comparison
test('a matching sha reports MATCH', () => {
  const c = compareRelease(resolveReleaseIdentity({ CANA_RELEASE_SHA: SHA }), SHA);
  assert.equal(c.match, true);
  assert.equal(c.verdict, 'MATCH');
});

test('a MISMATCH says plainly that the artifact is not the expected commit', () => {
  const c = compareRelease(resolveReleaseIdentity({ CANA_RELEASE_SHA: SHA }), 'c'.repeat(40));
  assert.equal(c.match, false);
  assert.equal(c.verdict, 'MISMATCH');
  assert.match(c.detail, /not the commit you think it is/i);
});

test('CANNOT TELL is never reported as NO MATCH', () => {
  // The distinction that matters most. An unverifiable build is not a mismatched
  // build, and treating it as one would send an operator rolling back a release that
  // was probably fine — or worse, teach them to ignore the check.
  const c = compareRelease(resolveReleaseIdentity({}), SHA);
  assert.equal(c.match, null, 'match must be null, never false, when we cannot tell');
  assert.equal(c.verdict, 'UNVERIFIABLE');
  assert.match(c.detail, /cannot be compared/i);
});

test('no expectation is distinguished from an unverifiable build', () => {
  const c = compareRelease(resolveReleaseIdentity({ CANA_RELEASE_SHA: SHA }), 'garbage');
  assert.equal(c.verdict, 'NO_EXPECTATION');
  assert.equal(c.match, null);
});

// -------------------------------------------------------- build-time capture
test('the BUILD captures the sha, and it is NOT in a client bundle', () => {
  // Two properties in one test because they trade off: the value must reach the
  // server, and must NOT reach browsers. Build metadata in a client bundle is free
  // reconnaissance for no product benefit.
  const cfg = execFileSync('node', ['-e', `
    const fs = require('fs');
    const src = fs.readFileSync('next.config.ts', 'utf8');
    console.log(JSON.stringify({
      capturesEnv: /CANA_RELEASE_SHA/.test(src),
      readsAtBuildTime: /process\\.env\\.CANA_RELEASE_SHA/.test(src),
      publicPrefixed: /NEXT_PUBLIC_[A-Z_]*RELEASE/.test(src),
    }));
  `], { cwd: process.cwd(), encoding: 'utf8' });
  const r = JSON.parse(cfg);
  assert.equal(r.capturesEnv, true, 'the build config must capture the release sha');
  assert.equal(r.readsAtBuildTime, true, 'it must be read at BUILD time — a deployed artifact has no .git');
  assert.equal(r.publicPrefixed, false, 'it must NOT be exposed to client bundles via NEXT_PUBLIC_');
});

test('the module never shells out to git', () => {
  // A runtime `git rev-parse` works in development and silently returns nothing in
  // production, which is the failure mode this whole module exists to avoid.
  const src = execFileSync('node', ['-e',
    "console.log(require('fs').readFileSync('src/lib/release-identity.mjs','utf8'))"],
    { cwd: process.cwd(), encoding: 'utf8' });
  // Strip COMMENTS before scanning. My first version grepped raw source, so writing
  // a comment that explains why we do NOT shell out to git failed the test that
  // checks we do not shell out to git. A security assertion that punishes its own
  // documentation teaches people to delete the documentation.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');        // line comments
  assert.ok(!/child_process|execSync|spawnSync|execFileSync/.test(code),
    'release identity must never spawn a process — a runtime git call works in dev and silently fails in production');
  assert.ok(!/rev-parse/.test(code),
    'no git invocation may appear in executable code');
});
