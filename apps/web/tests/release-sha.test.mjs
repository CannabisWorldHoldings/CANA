/**
 * RELEASE SHA ENDPOINT — /api/release contract.
 *
 * The deployed app must expose its exact Git release SHA so the repository
 * and the runtime can be compared. Three laws, each falsifiable here:
 *
 *   1. PRESENT WHEN BUILT — the SHA is read verbatim from a build-time
 *      identity file (release.json / receipt.json at the artifact root,
 *      written by deploy/namecheap/build-artifact.mjs).
 *   2. EXPLICITLY UNKNOWN WHEN NOT — no identity file means HTTP 503 and
 *      state RELEASE_SHA_MISSING. Absence is a visible defect state, not a
 *      silent 200 "unknown".
 *   3. NEVER FABRICATED — the resolver returns either the exact validated
 *      40-hex value from the file, or null. Malformed values are not echoed
 *      as SHAs; runtime env vars (VERCEL_GIT_COMMIT_SHA and friends) are
 *      never consulted; git is never shelled out to (a deployed artifact has
 *      no .git directory).
 *
 * These tests need no running server: the resolver and the wire body are
 * pure functions in src/app/api/release/release-identity.mjs, and the
 * route/builder contracts are asserted against source text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveReleaseIdentity,
  releaseResponseBody,
  RELEASE_STATES,
  FULL_SHA_PATTERN,
} from '../src/app/api/release/release-identity.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');

const VALID_SHA = 'a8c82be00b6ad30adba978fdc856c7c9634d3355';

/** A scratch cwd per test so no test can see another's identity file. */
function scratchDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sha-'));
  return dir;
}

function writeIdentity(dir, name, contents) {
  fs.writeFileSync(
    path.join(dir, name),
    typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2),
  );
}

// ---------------------------------------------------------------------------
// Law 1 — PRESENT WHEN BUILT
// ---------------------------------------------------------------------------

test('release.json with a full 40-hex gitSha resolves PRESENT with the verbatim SHA', () => {
  const dir = scratchDir();
  try {
    writeIdentity(dir, 'release.json', {
      gitSha: VALID_SHA,
      builtAt: '2026-07-26T00:00:00.000Z',
      artifact: 'orderweeddc-a8c82be',
    });
    const identity = resolveReleaseIdentity({ cwd: dir, env: {} });
    assert.equal(identity.state, RELEASE_STATES.PRESENT);
    assert.equal(identity.httpStatus, 200);
    assert.equal(identity.gitSha, VALID_SHA, 'the SHA must be the exact file value');
    assert.equal(identity.shortSha, VALID_SHA.slice(0, 7));
    assert.equal(identity.builtAt, '2026-07-26T00:00:00.000Z');
    assert.equal(identity.artifact, 'orderweeddc-a8c82be');
    assert.equal(identity.source, 'release.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('receipt.json is accepted as fallback when release.json is absent (every shipped artifact carries it)', () => {
  const dir = scratchDir();
  try {
    writeIdentity(dir, 'receipt.json', { gitSha: VALID_SHA, artifact: 'orderweeddc-a8c82be' });
    const identity = resolveReleaseIdentity({ cwd: dir, env: {} });
    assert.equal(identity.state, RELEASE_STATES.PRESENT);
    assert.equal(identity.gitSha, VALID_SHA);
    assert.equal(identity.source, 'receipt.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release.json wins over receipt.json when both exist (slim contract is authoritative)', () => {
  const dir = scratchDir();
  const otherSha = 'b'.repeat(40);
  try {
    writeIdentity(dir, 'release.json', { gitSha: VALID_SHA });
    writeIdentity(dir, 'receipt.json', { gitSha: otherSha });
    const identity = resolveReleaseIdentity({ cwd: dir, env: {} });
    assert.equal(identity.gitSha, VALID_SHA);
    assert.equal(identity.source, 'release.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RELEASE_RECEIPT_PATH override is honoured (explicit operator/test pin)', () => {
  const dir = scratchDir();
  try {
    const custom = path.join(dir, 'pinned-identity.json');
    fs.writeFileSync(custom, JSON.stringify({ gitSha: VALID_SHA }));
    const identity = resolveReleaseIdentity({
      cwd: scratchDir(), // empty cwd: only the override can supply the SHA
      env: { RELEASE_RECEIPT_PATH: custom },
    });
    assert.equal(identity.state, RELEASE_STATES.PRESENT);
    assert.equal(identity.gitSha, VALID_SHA);
    assert.equal(identity.source, 'env:RELEASE_RECEIPT_PATH');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Law 2 — EXPLICITLY UNKNOWN WHEN NOT BUILT
// ---------------------------------------------------------------------------

test('no identity file -> RELEASE_SHA_MISSING with HTTP 503, never a 200 shrug', () => {
  const dir = scratchDir();
  try {
    const identity = resolveReleaseIdentity({ cwd: dir, env: {} });
    assert.equal(identity.state, RELEASE_STATES.MISSING);
    assert.equal(identity.httpStatus, 503, 'a deployment without provenance is DEFECTIVE, so not-200');
    assert.equal(identity.gitSha, null);
    assert.equal(identity.shortSha, null);
    assert.ok(identity.problem, 'the missing state must explain itself');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the MISSING wire body contains no sha-shaped value anywhere (nothing to mistake for an identity)', () => {
  const dir = scratchDir();
  try {
    const body = releaseResponseBody(resolveReleaseIdentity({ cwd: dir, env: {} }));
    assert.equal(body.status, RELEASE_STATES.MISSING);
    assert.equal(body.gitSha, null);
    const serialized = JSON.stringify(body);
    assert.ok(
      !/[0-9a-f]{40}/.test(serialized),
      `MISSING body must not carry anything resembling a SHA: ${serialized}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Law 3 — NEVER FABRICATED
// ---------------------------------------------------------------------------

test('malformed gitSha values are refused as INVALID and never echoed back as the SHA', () => {
  const malformed = [
    'a8c82be', // short sha — plausible-looking, still not an identity
    'HEAD',
    'unknown',
    'dev',
    VALID_SHA.slice(0, 39), // one hex short
    `${VALID_SHA}0`, // one hex long
    VALID_SHA.toUpperCase(), // git SHAs are lowercase hex; uppercase means someone typed it
    'g'.repeat(40), // right length, not hex
    '', // empty string
  ];
  for (const bad of malformed) {
    const dir = scratchDir();
    try {
      writeIdentity(dir, 'release.json', { gitSha: bad });
      const identity = resolveReleaseIdentity({ cwd: dir, env: {} });
      assert.equal(identity.state, RELEASE_STATES.INVALID, `must refuse gitSha=${JSON.stringify(bad)}`);
      assert.equal(identity.httpStatus, 503);
      assert.equal(identity.gitSha, null, `must not echo ${JSON.stringify(bad)} as an identity`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('an identity file with no gitSha field, or unparseable JSON, is INVALID — not silently MISSING', () => {
  for (const contents of [{ builtAt: '2026-07-26' }, '{"gitSha": tru']) {
    const dir = scratchDir();
    try {
      writeIdentity(dir, 'release.json', contents);
      const identity = resolveReleaseIdentity({ cwd: dir, env: {} });
      assert.equal(identity.state, RELEASE_STATES.INVALID);
      assert.equal(identity.gitSha, null);
      assert.ok(identity.problem);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('runtime env vars carrying SHAs are NEVER consulted — only the build-time file counts', () => {
  const dir = scratchDir();
  try {
    const identity = resolveReleaseIdentity({
      cwd: dir,
      env: {
        // Every common CI/hosting variable an implementation might be tempted
        // to fall back to. All valid-shaped. None may surface.
        VERCEL_GIT_COMMIT_SHA: 'c'.repeat(40),
        GIT_COMMIT: 'd'.repeat(40),
        SOURCE_COMMIT: 'e'.repeat(40),
        GITHUB_SHA: 'f'.repeat(40),
        RELEASE_SHA: 'a'.repeat(40),
      },
    });
    assert.equal(identity.state, RELEASE_STATES.MISSING,
      'an operator-typed env SHA is not build provenance and must not be reported as one');
    assert.equal(identity.gitSha, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the resolver reports only what the file says: PRESENT body SHA equals the file SHA byte-for-byte', () => {
  const dir = scratchDir();
  try {
    writeIdentity(dir, 'release.json', { gitSha: VALID_SHA });
    const body = releaseResponseBody(resolveReleaseIdentity({ cwd: dir, env: {} }));
    assert.equal(body.status, RELEASE_STATES.PRESENT);
    assert.equal(body.gitSha, VALID_SHA);
    assert.match(body.gitSha, FULL_SHA_PATTERN);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Wire hygiene — the body leaks no filesystem paths (release gate G1 law)
// ---------------------------------------------------------------------------

test('response body never contains an absolute filesystem path, in any state', () => {
  const cases = [];
  const presentDir = scratchDir();
  writeIdentity(presentDir, 'release.json', { gitSha: VALID_SHA });
  cases.push(resolveReleaseIdentity({ cwd: presentDir, env: {} }));
  const invalidDir = scratchDir();
  writeIdentity(invalidDir, 'receipt.json', { gitSha: 'nope' });
  cases.push(resolveReleaseIdentity({ cwd: invalidDir, env: {} }));
  const missingDir = scratchDir();
  cases.push(resolveReleaseIdentity({ cwd: missingDir, env: {} }));
  try {
    for (const identity of cases) {
      const serialized = JSON.stringify(releaseResponseBody(identity));
      assert.ok(!serialized.includes(os.tmpdir()), `leaked a real path: ${serialized}`);
      assert.ok(
        !/\/(home|agent|tmp|var)\//.test(serialized),
        `leaked an absolute path: ${serialized}`,
      );
      assert.ok(!/node_modules|\.next\/server/.test(serialized), `leaked internals: ${serialized}`);
    }
  } finally {
    for (const dir of [presentDir, invalidDir, missingDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Route + builder source contracts — the wiring cannot silently regress
// ---------------------------------------------------------------------------

test('route.ts: force-dynamic, no-store, resolver-backed, and NEVER shells out to git', () => {
  const route = fs.readFileSync(
    path.join(webRoot, 'src/app/api/release/route.ts'),
    'utf8',
  );
  // The documentation is allowed to EXPLAIN why git is off-limits; the
  // executable code is not allowed to touch it. Strip comments, then judge.
  const code = route
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /export const dynamic = 'force-dynamic'/,
    'release identity must never be served from a build-time page cache');
  assert.match(code, /no-store/, 'a cached SHA is a false claim about what is running');
  assert.match(code, /resolveReleaseIdentity/, 'the route must use the tested resolver');
  assert.doesNotMatch(code, /child_process|execSync|spawnSync|execFile|spawn\(/,
    'the route must not shell out — a deployed artifact has no .git to ask');
  assert.doesNotMatch(code, /git rev-parse|\.git\b/,
    'no runtime git interrogation of any kind');
  // Same law for the resolver module the route delegates to.
  const resolver = fs
    .readFileSync(path.join(webRoot, 'src/app/api/release/release-identity.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(resolver, /child_process|execSync|spawnSync|execFile|spawn\(/,
    'the resolver must not shell out either');
  assert.doesNotMatch(resolver, /git rev-parse|\.git\b/);
});

test('builder contract: build-artifact.mjs writes release.json with the build SHA and the isolated runtime test proves /api/release serves it', () => {
  const builder = fs.readFileSync(
    path.join(repoRoot, 'deploy/namecheap/build-artifact.mjs'),
    'utf8',
  );
  assert.match(builder, /release\.json/, 'builder must produce the slim identity file');
  assert.match(builder, /writeReleaseIdentity|releaseIdentity/,
    'identity write must be an explicit named step');
  assert.match(builder, /api\/release/,
    'the isolated runtime test must exercise the live endpoint against the built SHA');
});
