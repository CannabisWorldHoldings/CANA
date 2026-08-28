/**
 * RELEASE IDENTITY — resolve the deployed Git SHA from a BUILD-TIME artifact.
 *
 * Why not `git rev-parse`: the deployed artifact has no `.git` directory, so
 * shelling out at runtime can only fabricate or fail. Artifact-root identity
 * files remain the strongest source. OpenNext Workers cannot retain those
 * files at process.cwd(), so they may fall back to the SHA Next substituted
 * into the compiled Worker during the exact-source build court. A runtime
 * operator variable is never consulted.
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
 * NEVER FABRICATED. gitSha is an exact validated file value, the exact bundled
 * build value, or null. No runtime env fallback, no "dev", and no "unknown"
 * masquerading as a SHA. Tests:
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

/**
 * Platform builds do not necessarily retain artifact-root files. In that
 * environment Next replaces CANA_RELEASE_SHA while compiling the exact source
 * tree, so the resulting literal is part of the Worker bytes rather than a
 * runtime operator setting. File identity remains authoritative whenever it is
 * present; the bundled value is only the missing-file fallback.
 *
 * @param {{ cwd?: string, env?: Record<string, string|undefined>,
 *           bundledSha?: string }} options
 */
export function resolveReleaseIdentityWithBundledSha({
  cwd = process.cwd(),
  env = process.env,
  bundledSha,
} = {}) {
  const artifactIdentity = resolveReleaseIdentity({ cwd, env });
  if (artifactIdentity.state !== RELEASE_STATES.MISSING) return artifactIdentity;
  if (bundledSha === undefined || bundledSha === null || bundledSha === '') {
    return artifactIdentity;
  }
  if (typeof bundledSha !== 'string' || !FULL_SHA_PATTERN.test(bundledSha)) {
    return invalid(
      'bundled:CANA_RELEASE_SHA',
      'bundled gitSha is not a full 40-hex commit SHA',
    );
  }
  return {
    state: RELEASE_STATES.PRESENT,
    httpStatus: 200,
    gitSha: bundledSha,
    shortSha: bundledSha.slice(0, 7),
    builtAt: null,
    artifact: 'opennext-cloudflare',
    source: 'bundled:CANA_RELEASE_SHA',
    problem: null,
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
