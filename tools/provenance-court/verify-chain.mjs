#!/usr/bin/env node
/**
 * DEPLOYMENT PROVENANCE INTEGRITY COURT — chain verifier (Track B, P0).
 *
 * Proves (or refuses to certify) the identity chain:
 *
 *   SOURCE SHA -> BUILD ARTIFACT -> DEPLOYMENT RECEIPT -> ACTIVE RELEASE
 *              -> RENDERED SURFACE -> EXTERNAL OBSERVATION
 *
 * VERDICT LAW — the court FAILS CLOSED:
 *  - Every link must be GREEN for the chain to be GREEN. One RED link, or
 *    one link the court cannot evaluate, makes the chain RED.
 *  - Absence is RED, never a shrug: a missing receipt, a missing release
 *    identity, a surface without the cana-release-sha meta tag — all RED.
 *  - The court never fabricates: it reports exactly what each link presented.
 *  - NO EXACT TREATMENT IDENTITY -> NO CAUSAL SETTLEMENT. A RED chain means
 *    outcomes observed on that surface must not be attributed to the source.
 *
 * The verifier core is PURE (inputs injected) so the sabotage suite can
 * corrupt each link and prove the court turns red — an evaluator that stays
 * green on a corrupted chain FAILS CERTIFICATION (see sabotage.test.mjs).
 *
 * CLI (each input readable from file or URL):
 *   node tools/provenance-court/verify-chain.mjs \
 *     --source-sha <40hex> --receipt <path> \
 *     --release <url-or-path> --surface <url-or-path> [--out receipt.json]
 */

import fs from 'node:fs';

export const FULL_SHA = /^[0-9a-f]{40}$/;
/** Max tolerated clock skew before a build timestamp is "from the future". */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function link(name, status, why, observed = null) {
  return { name, status, why, observed };
}

/**
 * Pure chain verdict. All evidence injected; no I/O, no clock reads.
 *
 * @param {{
 *   sourceSha?: string|null,
 *   receipt?: { gitSha?: string, builtAt?: string, artifact?: string }|null,
 *   release?: { state?: string, gitSha?: string|null }|null,
 *   surfaceHtml?: string|null,
 *   now?: Date,
 * }} evidence
 * @returns {{ verdict: 'GREEN'|'RED', links: Array<object> }}
 */
export function verifyChain(evidence) {
  const now = evidence.now instanceof Date ? evidence.now : new Date();
  const links = [];

  // LINK 1 — SOURCE: a full, exact commit identity. Short SHAs, refs, "HEAD",
  // "unknown" are all refused: no exact treatment identity, no settlement.
  const sourceSha = evidence.sourceSha ?? null;
  if (typeof sourceSha === 'string' && FULL_SHA.test(sourceSha)) {
    links.push(link('SOURCE', 'GREEN', 'full 40-hex commit identity', { sourceSha }));
  } else {
    links.push(link('SOURCE', 'RED', `source SHA missing or not a full commit: ${String(sourceSha)}`));
  }

  // LINK 2 — ARTIFACT: the build receipt must exist, carry a valid SHA that
  // MATCHES the source, and a build time that is not from the future.
  const receipt = evidence.receipt ?? null;
  if (!receipt || typeof receipt !== 'object') {
    links.push(link('ARTIFACT', 'RED', 'build receipt missing — an artifact without a receipt has no identity'));
  } else if (typeof receipt.gitSha !== 'string' || !FULL_SHA.test(receipt.gitSha)) {
    links.push(link('ARTIFACT', 'RED', `receipt gitSha missing/invalid: ${String(receipt.gitSha)}`, { receipt }));
  } else if (sourceSha && receipt.gitSha !== sourceSha) {
    links.push(link('ARTIFACT', 'RED', `receipt gitSha ${receipt.gitSha.slice(0, 12)}… does not match source ${String(sourceSha).slice(0, 12)}…`, { receipt }));
  } else {
    const artifactIdentity = typeof receipt.artifact === 'string'
      ? receipt.artifact.match(/^orderweeddc-([0-9a-f]{7,40})(?:\.tar\.gz)?$/)
      : null;
    const builtAt = receipt.builtAt ? new Date(receipt.builtAt) : null;
    if (!artifactIdentity || artifactIdentity[1] !== receipt.gitSha.slice(0, artifactIdentity[1]?.length)) {
      links.push(link('ARTIFACT', 'RED', `artifact name is missing or does not bind receipt gitSha: ${String(receipt.artifact)}`, { receipt }));
    } else if (!builtAt || !Number.isFinite(builtAt.getTime())) {
      links.push(link('ARTIFACT', 'RED', `receipt builtAt missing/unreadable: ${String(receipt.builtAt)}`, { receipt }));
    } else if (builtAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
      links.push(link('ARTIFACT', 'RED', `receipt builtAt is in the future: ${receipt.builtAt} — tampered or clock-forged`, { receipt }));
    } else {
      links.push(link('ARTIFACT', 'GREEN', 'receipt matches source; build time sane', {
        gitSha: receipt.gitSha, builtAt: receipt.builtAt, artifact: receipt.artifact ?? null,
      }));
    }
  }

  // LINK 3 — ACTIVE RELEASE: what the deployment says it is running. The
  // /api/release contract already refuses to fabricate; the court refuses to
  // accept anything but RELEASE_SHA_PRESENT with a SHA matching the receipt.
  const release = evidence.release ?? null;
  if (!release || typeof release !== 'object') {
    links.push(link('RELEASE', 'RED', 'release identity missing — the deployment cannot say what it is running'));
  } else if (release.state !== 'RELEASE_SHA_PRESENT' || typeof release.gitSha !== 'string' || !FULL_SHA.test(release.gitSha)) {
    links.push(link('RELEASE', 'RED', `release state is ${String(release.state)} — absence/invalidity is a defect, not a shrug`, { release }));
  } else if (receipt?.gitSha && release.gitSha !== receipt.gitSha) {
    links.push(link('RELEASE', 'RED', `active release ${release.gitSha.slice(0, 12)}… does not match artifact ${receipt.gitSha.slice(0, 12)}…`, { release }));
  } else if (!receipt?.gitSha && sourceSha && FULL_SHA.test(sourceSha) && release.gitSha !== sourceSha) {
    links.push(link('RELEASE', 'RED', `active release ${release.gitSha.slice(0, 12)}… does not match source ${sourceSha.slice(0, 12)}… (no receipt to compare through)`, { release }));
  } else {
    links.push(link('RELEASE', 'GREEN', receipt?.gitSha
      ? 'active release matches the artifact receipt'
      : 'active release matches the source identity (no artifact receipt presented)', { gitSha: release.gitSha }));
  }

  // LINK 4 — RENDERED SURFACE: the page an external observer actually
  // received must carry the same identity. A surface without the meta tag is
  // RED — an unidentifiable treatment cannot settle anything.
  const html = evidence.surfaceHtml ?? null;
  if (typeof html !== 'string' || html.length === 0) {
    links.push(link('SURFACE', 'RED', 'rendered surface missing — external observation was not captured'));
  } else {
    const meta = html.match(/<meta[^>]+name="cana-release-sha"[^>]+content="([^"]*)"/i)
      ?? html.match(/<meta[^>]+content="([^"]*)"[^>]+name="cana-release-sha"/i);
    const surfaceSha = meta?.[1] ?? null;
    if (!surfaceSha || !FULL_SHA.test(surfaceSha)) {
      links.push(link('SURFACE', 'RED', 'rendered surface carries no valid cana-release-sha identity', { surfaceSha }));
    } else if (release?.gitSha && surfaceSha !== release.gitSha) {
      links.push(link('SURFACE', 'RED', `surface identity ${surfaceSha.slice(0, 12)}… does not match active release ${String(release.gitSha).slice(0, 12)}…`, { surfaceSha }));
    } else if (sourceSha && surfaceSha !== sourceSha) {
      links.push(link('SURFACE', 'RED', `surface identity ${surfaceSha.slice(0, 12)}… does not match source ${String(sourceSha).slice(0, 12)}…`, { surfaceSha }));
    } else {
      links.push(link('SURFACE', 'GREEN', 'externally observed surface carries the exact chain identity', { surfaceSha }));
    }
  }

  const verdict = links.every((l) => l.status === 'GREEN') ? 'GREEN' : 'RED';
  return { verdict, links };
}

/** Read a --flag value from argv. */
function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

async function readSource(ref) {
  if (!ref) return null;
  if (/^https?:\/\//.test(ref)) {
    const response = await fetch(ref, { signal: AbortSignal.timeout(20_000) });
    return response.text();
  }
  return fs.readFileSync(ref, 'utf8');
}

async function main() {
  const argv = process.argv.slice(2);
  const sourceSha = argValue(argv, '--source-sha');
  const receiptPath = argValue(argv, '--receipt');
  const releaseRef = argValue(argv, '--release');
  const surfaceRef = argValue(argv, '--surface');
  const outPath = argValue(argv, '--out');

  let receipt = null;
  try {
    receipt = receiptPath ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
  } catch { receipt = null; /* missing/corrupt receipt stays null -> RED */ }

  let release = null;
  try {
    const body = await readSource(releaseRef);
    const parsed = body ? JSON.parse(body) : null;
    // The live /api/release endpoint answers { status, gitSha }; the internal
    // identity object uses { state, gitSha }; older shapes used git_sha.
    // Adapt the field names verbatim — never the values.
    release = parsed
      ? { state: parsed.state ?? parsed.status ?? null, gitSha: parsed.gitSha ?? parsed.git_sha ?? null }
      : null;
  } catch { release = null; }

  let surfaceHtml = null;
  try { surfaceHtml = await readSource(surfaceRef); } catch { surfaceHtml = null; }

  const result = verifyChain({ sourceSha, receipt, release, surfaceHtml, now: new Date() });
  const courtReceipt = {
    court: 'deployment-provenance-integrity',
    version: 1,
    verified_at: new Date().toISOString(),
    inputs: { sourceSha, receiptPath, releaseRef, surfaceRef },
    ...result,
  };
  const serialized = JSON.stringify(courtReceipt, null, 2);
  console.log(serialized);
  if (outPath) fs.writeFileSync(outPath, serialized);
  process.exit(result.verdict === 'GREEN' ? 0 : 1);
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(JSON.stringify({ court: 'deployment-provenance-integrity', verdict: 'RED', error: String(error?.message ?? error) }));
    process.exit(1);
  });
}
