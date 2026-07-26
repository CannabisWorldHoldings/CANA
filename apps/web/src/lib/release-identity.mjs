/**
 * RELEASE IDENTITY — what commit is actually running?
 *
 * THE PROBLEM. A deployed artifact has no `.git` directory, so a runtime that shells
 * out to git reports nothing in production and works perfectly in development —
 * which is the worst possible combination, because it looks fine everywhere it is
 * tested. Nothing in this codebase currently exposes the deployed commit at all, so
 * there is no way to answer "is the server running the code I think it is?"
 *
 * That question is not academic here. This project has already produced TWO false
 * verdicts from stale builds: a verifier removed a guard, re-ran the suite without
 * rebuilding, saw green, and reported a coverage defect that did not exist. Next
 * serves compiled bytes. Without a release identity, "the running server matches
 * HEAD" is an assumption, and assumptions of exactly that shape have cost this
 * mission real time twice.
 *
 * SCOPE NOTE — READ THIS BEFORE EXTENDING THIS MODULE.
 *
 * Two implementations of this idea were written in parallel: this one, which reads
 * the SHA from a BUILD-TIME ENVIRONMENT VARIABLE, and the cPanel lane's, which reads
 * it from the `receipt.json` the existing deploy pipeline already emits (see
 * deploy/namecheap/build-artifact.mjs, which has captured `git rev-parse HEAD` into
 * a receipt since before this work).
 *
 * THE LANE'S APPROACH IS STRONGER and is the primary path. An env var must be
 * remembered at build time by whoever runs the build; a receipt file is produced by
 * the pipeline whether or not anyone remembers. A mechanism that depends on human
 * discipline to be present will be absent exactly when it matters.
 *
 * This module is retained as the ENV FALLBACK for build contexts that have no
 * receipt (a plain `npm run build`, CI, a platform that injects its own commit var),
 * and for the comparison helper below. It must never contradict the receipt: when
 * both exist, the receipt wins, because it is the artifact the deployment actually
 * shipped.
 *
 * THE RULE THIS MODULE ENFORCES: an unknown SHA is reported as UNKNOWN, loudly and
 * explicitly. It is never guessed, never defaulted to "main", never filled in with a
 * timestamp that looks like an answer. A release endpoint that fabricates an
 * identity is worse than no endpoint, because it converts an operator's question
 * into a confident wrong answer.
 */

const HEX40 = /^[0-9a-f]{40}$/i;

/** Environment variables a build or host may legitimately supply, in priority order. */
export const RELEASE_SHA_SOURCES = Object.freeze([
  'CANA_RELEASE_SHA',      // set deliberately by our own build/deploy scripts
  'VERCEL_GIT_COMMIT_SHA', // set automatically by Vercel
  'GIT_COMMIT',            // common CI convention
  'SOURCE_COMMIT',         // common container convention
]);

/**
 * Resolve the release identity from the environment captured AT BUILD TIME.
 *
 * @param {Record<string,string|undefined>} env
 * @returns {{ sha: string|null, short: string|null, source: string|null,
 *             state: 'KNOWN'|'UNKNOWN'|'MALFORMED', detail: string }}
 */
export function resolveReleaseIdentity(env = {}) {
  for (const key of RELEASE_SHA_SOURCES) {
    const raw = env[key];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const value = raw.trim();
    if (!HEX40.test(value)) {
      // A malformed value is reported as MALFORMED rather than silently ignored.
      // Ignoring it would let a broken deploy pipeline look identical to one that
      // never set the variable, and those need different fixes.
      return {
        sha: null, short: null, source: key, state: 'MALFORMED',
        detail: `${key} is set but is not a 40-character git sha; a deploy pipeline is misconfigured`,
      };
    }
    return {
      sha: value.toLowerCase(),
      short: value.toLowerCase().slice(0, 7),
      source: key,
      state: 'KNOWN',
      detail: `resolved from ${key} at build time`,
    };
  }
  return {
    sha: null, short: null, source: null, state: 'UNKNOWN',
    detail: 'no release sha was captured at build time — this build cannot be matched to a commit. '
      + `Set one of ${RELEASE_SHA_SOURCES.join(', ')} during the build.`,
  };
}

/**
 * Is the running artifact provably the commit an operator expects?
 *
 * Returns a verdict rather than a boolean, because "we cannot tell" is a materially
 * different answer from "no" and must not be collapsed into it.
 */
export function compareRelease(identity, expectedSha) {
  if (!identity || identity.state !== 'KNOWN') {
    return {
      match: null,
      verdict: 'UNVERIFIABLE',
      detail: 'the running build carries no release identity, so it cannot be compared to any commit',
    };
  }
  if (typeof expectedSha !== 'string' || !HEX40.test(expectedSha.trim())) {
    return { match: null, verdict: 'NO_EXPECTATION', detail: 'no valid expected sha was supplied' };
  }
  const expected = expectedSha.trim().toLowerCase();
  return identity.sha === expected
    ? { match: true, verdict: 'MATCH', detail: `running ${identity.short}` }
    : {
        match: false,
        verdict: 'MISMATCH',
        detail: `running ${identity.short} but expected ${expected.slice(0, 7)} — the deployed artifact is not the commit you think it is`,
      };
}
