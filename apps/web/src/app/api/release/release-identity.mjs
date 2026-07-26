/**
 * RELEASE IDENTITY — resolve the deployed Git SHA from a BUILD-TIME artifact.
 *
 * Why a file and not `git rev-parse`: the deployed artifact has no `.git`
 * directory (it is a tar of the standalone build), so shelling out to git at
 * runtime can only ever fabricate or fail. Why not an env var: a runtime
 * environment variable is operator-typed, not build-derived — it can drift
 * from the bytes actually running. The ONLY trusted source is a file the
 * release builder wrote next to `server.js` at build time:
 *
 *   release.json  — slim identity contract written by
 *                   deploy/namecheap/build-artifact.mjs: { gitSha, builtAt,
 *                   artifact, bundler }
 *   receipt.json  — the full build receipt (same builder); accepted as a
 *                   fallback because every shipped artifact already carries it
 *
 * ABSENCE IS A STATE, NOT A SHRUG. Production incident 2026-07-23 shipped an
 * artifact (`orderweeddc-c1e8ac7`) built from a commit unreachable in the
 * remote repository — the running code could not be compared to the repo.
 * An endpoint that answers "unknown" with HTTP 200 would hide exactly that
 * class of defect behind a green check. So:
 *
 *   RELEASE_SHA_PRESENT  -> 200, the verbatim 40-hex SHA from the artifact
 *   RELEASE_SHA_MISSING  -> 503, no identity file: the deployment is defective
 *   RELEASE_SHA_INVALID  -> 503, identity file exists but its SHA is not a
 *                            full 40-hex commit — never echoed as if valid
 *
 * NEVER FABRICATED. gitSha in the result is either the exact validated file
 * value or null. No fallback to env vars (VERCEL_GIT_COMMIT_SHA etc.), no
 * "dev", no "unknown" masquerading as a SHA. Tests:
 * apps/web/tests/release-sha.test.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_STATES = Object.freeze({
  PRESENT: 'RELEASE_SHA_PRESENT',
  MISSING: 'RELEASE_SHA_MISSING',
  INVALID: 'RELEASE_SHA_INVALID',
});

/** A full commit SHA and nothing else. `HEAD`, short SHAs, refs all fail. */
export const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Candidate identity files, in trust order. `RELEASE_RECEIPT_PATH` is an
 * explicit operator/test override; the two well-known names sit at the
 * artifact root, which is the standalone server's working directory.
 */
function candidateFiles(cwd, env) {
  const candidates = [];
  if (env.RELEASE_RECEIPT_PATH) {
    candidates.push({ file: env.RELEASE_RECEIPT_PATH, source: 'env:RELEASE_RECEIPT_PATH' });
  }
  candidates.push(
    { file: path.join(cwd, 'release.json'), source: 'release.json' },
    { file: path.join(cwd, 'receipt.json'), source: 'receipt.json' },
  );
  return candidates;
}

/**
 * Resolve the release identity. Pure with respect to its inputs: no network,
 * no child processes, no git. Returns a plain object; never throws for an
 * absent or malformed file (those are the MISSING / INVALID states).
 *
 * @param {{ cwd?: string, env?: Record<string, string|undefined> }} options
 * @returns {{ state: string, httpStatus: number, gitSha: string|null,
 *             shortSha: string|null, builtAt: string|null,
 *             artifact: string|null, source: string|null, problem: string|null }}
 */
export function resolveReleaseIdentity({ cwd = process.cwd(), env = process.env } = {}) {
  for (const { file, source } of candidateFiles(cwd, env)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // not present -> try the next candidate
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return invalid(source, 'identity file exists but is not valid JSON');
    }

    const sha = parsed?.gitSha;
    if (typeof sha !== 'string' || sha.length === 0) {
      return invalid(source, 'identity file has no gitSha field');
    }
    if (!FULL_SHA_PATTERN.test(sha)) {
      // Deliberately do NOT echo the malformed value as a SHA. Reporting a
      // truncated or mistyped identity as though it were the release is the
      // fabrication this module exists to prevent.
      return invalid(source, 'gitSha is not a full 40-hex commit SHA');
    }

    return {
      state: RELEASE_STATES.PRESENT,
      httpStatus: 200,
      gitSha: sha,
      shortSha: sha.slice(0, 7),
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : null,
      artifact: typeof parsed.artifact === 'string' ? parsed.artifact : null,
      source,
      problem: null,
    };
  }

  return {
    state: RELEASE_STATES.MISSING,
    httpStatus: 503,
    gitSha: null,
    shortSha: null,
    builtAt: null,
    artifact: null,
    source: null,
    problem:
      'no release identity file (release.json/receipt.json) exists in this deployment — ' +
      'the artifact was not produced by the release builder, or it was tampered with after build',
  };
}

function invalid(source, problem) {
  return {
    state: RELEASE_STATES.INVALID,
    httpStatus: 503,
    gitSha: null,
    shortSha: null,
    builtAt: null,
    artifact: null,
    source,
    problem,
  };
}

/**
 * The exact HTTP response body for /api/release. Kept here (not in route.ts)
 * so the node:test suite can assert the wire contract without a server.
 * `source` is a basename or env marker, never an absolute filesystem path —
 * release gate G1 forbids leaking paths.
 */
export function releaseResponseBody(identity, { now = () => new Date() } = {}) {
  return {
    status: identity.state,
    gitSha: identity.gitSha,
    shortSha: identity.shortSha,
    builtAt: identity.builtAt,
    artifact: identity.artifact,
    source: identity.source,
    ...(identity.problem === null ? {} : { problem: identity.problem }),
    checkedAt: now().toISOString(),
  };
}
