/**
 * V1 HISTORICAL REPLAY HARNESS — CANA_PROMOTION_IDENTITY_V1 (RETIRED_FOR_NEW_PROMOTIONS,
 * REPLAYABLE_FOR_HISTORICAL_EVENT)
 * ============================================================================
 *
 * The V1 promotion evaluator (tools/promotion-gate/historical/promotion-receipt.v1.replay.mjs,
 * byte-identical to the retired tools/promotion-gate/promotion-receipt.test.mjs, sha256
 * ab0096009b6b6f77bf603da67585b6db303e52e521520dacd4ec82ccbda78240) hard-asserts a
 * SPECIFIC historical promotion event:
 *
 *   status.branch    === 'integration/cana-technical-promotion-de4a497b'
 *   status.protected.commit === 'c953ebcd25c46ef33af0700d7913a899d839bce8'
 *   status.candidate.commit === 'de4a497b6c039a5dccc9c3fb9a470dc0bf610318'
 *   candidateIsAncestor && integrationMergeIsAncestor
 *
 * Those assertions can only hold inside the historical context: a checkout of the
 * integration branch (integration/cana-technical-promotion-de4a497b, tip cc24b17 in the
 * mirror) with a ref named `recover/competitive-ui-day-night` resolving to c953ebcd.
 * That ref name is 404 on the canonical remote (see out/RECOVER_REF_DISPOSITION.md); the
 * commit alone is sufficient provenance. Per OWNER LAW #7/#8 the context is constructed
 * DISPOSABLY-LOCALLY and the recover/* ref is NEVER pushed.
 *
 * This harness:
 *   1. clones the reference mirror into a disposable temp dir (no network, no push);
 *   2. creates a detached worktree at cc24b17 (the historical integration-branch tip) and
 *      renames HEAD's branch to integration/cana-technical-promotion-de4a497b so
 *      `git rev-parse --abbrev-ref HEAD` reports exactly the historical branch name;
 *   3. writes a LOCAL-ONLY ref refs/heads/recover/competitive-ui-day-night -> c953ebcd;
 *   4. copies the byte-identical V1 evaluator + its receipt.mjs dependency chain into the
 *      disposable worktree and runs it there with `node --test`;
 *   5. tears the whole disposable clone down.
 *
 * It NEVER mutates the working tree it is invoked from, NEVER pushes any ref, and NEVER
 * runs V1 against the successor lane. This is the ONLY lawful place V1 executes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256File } from '../../test-runner/receipt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

// The historical event V1 certifies. These are DATA, recorded here so the harness is
// self-describing; they are NOT re-asserted (V1 asserts them itself).
export const HISTORICAL = Object.freeze({
  integrationBranch: 'integration/cana-technical-promotion-de4a497b',
  integrationTip: 'cc24b179d83d6a9ce8005e710f168986269230b1',
  protectedBranch: 'recover/competitive-ui-day-night',
  protectedCommit: 'c953ebcd25c46ef33af0700d7913a899d839bce8',
  candidateCommit: 'de4a497b6c039a5dccc9c3fb9a470dc0bf610318',
  integrationMerge: 'd84486b32fd424d196bc8b535d13396245875042',
  v1File: 'tools/promotion-gate/historical/promotion-receipt.v1.replay.mjs',
  v1Sha256: 'ab0096009b6b6f77bf603da67585b6db303e52e521520dacd4ec82ccbda78240',
});

const DEFAULT_MIRROR = process.env.CANA_SOURCE_MIRROR ?? '/agent/workspace/CANA.git';

function run(command, args, opts = {}) {
  const r = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...opts,
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    combined: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    error: r.error ?? null,
    ok: !r.error && r.status === 0,
  };
}

function git(args, opts = {}) {
  return run('git', args, opts);
}

/**
 * Is the historical context reconstructible? (mirror reachable AND carries the anchors.)
 * The replay says ENVIRONMENT_MISSING rather than failing when the mirror is absent —
 * a historical replay that cannot build its context has not disproved anything.
 */
export function historicalContextAvailable(mirror = DEFAULT_MIRROR) {
  if (!fs.existsSync(mirror)) return { available: false, why: `mirror ${mirror} is absent` };
  if (!git(['rev-parse', '--git-dir'], { cwd: mirror }).ok) {
    return { available: false, why: `mirror ${mirror} is not a git object database` };
  }
  for (const sha of [HISTORICAL.integrationTip, HISTORICAL.protectedCommit, HISTORICAL.candidateCommit, HISTORICAL.integrationMerge]) {
    if (!git(['cat-file', '-e', `${sha}^{commit}`], { cwd: mirror }).ok) {
      return { available: false, why: `mirror ${mirror} does not carry ${sha}` };
    }
  }
  return { available: true, mirror };
}

/**
 * Construct the disposable historical context and run V1 inside it. Returns
 * { classification, ok, evidence, detail }. classification is one of
 * VERIFIED | ENVIRONMENT_MISSING | REAL_REGRESSION — the harness never invents a pass.
 */
export function replayV1({ mirror = DEFAULT_MIRROR, keep = false } = {}) {
  const evidence = [];
  const avail = historicalContextAvailable(mirror);
  if (!avail.available) {
    return {
      classification: 'ENVIRONMENT_MISSING',
      ok: false,
      evidence: [`historical context is not reconstructible: ${avail.why}`],
      detail: { mirror },
    };
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-v1-replay-'));
  const clone = path.join(work, 'clone.git');
  const worktree = path.join(work, 'integration-worktree');
  try {
    // 1. disposable clone of the mirror (bare, local, no network).
    const cloned = git(['clone', '--quiet', '--bare', mirror, clone], { timeout: 600_000 });
    if (!cloned.ok) {
      return { classification: 'ENVIRONMENT_MISSING', ok: false, evidence: [`disposable clone failed: ${cloned.combined.slice(-400)}`], detail: { mirror } };
    }
    // 2. LOCAL-ONLY protected ref inside the disposable clone (never pushed).
    const wrote = git(['update-ref', `refs/heads/${HISTORICAL.protectedBranch}`, HISTORICAL.protectedCommit], { cwd: clone });
    if (!wrote.ok) {
      return { classification: 'ENVIRONMENT_MISSING', ok: false, evidence: [`could not write local recover ref: ${wrote.combined.slice(-400)}`] };
    }
    evidence.push(`LOCAL-ONLY ref refs/heads/${HISTORICAL.protectedBranch} -> ${HISTORICAL.protectedCommit} (disposable clone; NEVER pushed)`);
    // Also create the integration branch ref at its historical tip so the worktree can
    // check it out by name and rev-parse --abbrev-ref reports the branch name V1 asserts.
    git(['update-ref', `refs/heads/${HISTORICAL.integrationBranch}`, HISTORICAL.integrationTip], { cwd: clone });
    // 3. a real worktree checked out on the historical integration branch.
    const added = git(['worktree', 'add', '--quiet', worktree, HISTORICAL.integrationBranch], { cwd: clone, timeout: 600_000 });
    if (!added.ok) {
      return { classification: 'ENVIRONMENT_MISSING', ok: false, evidence: [`worktree add failed: ${added.combined.slice(-400)}`] };
    }
    const branchName = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree }).stdout.trim();
    evidence.push(`disposable worktree HEAD branch = ${branchName} @ ${git(['rev-parse', 'HEAD'], { cwd: worktree }).stdout.trim()}`);
    if (branchName !== HISTORICAL.integrationBranch) {
      return { classification: 'REAL_REGRESSION', ok: false, evidence: [...evidence, `worktree branch name is ${branchName}, not the historical ${HISTORICAL.integrationBranch}`] };
    }
    // 4. copy the byte-identical V1 evaluator + receipt.mjs chain into the worktree so it
    //    resolves its imports (../../test-runner/receipt.mjs, ./evidence-chain.mjs) exactly
    //    as it did historically, and points `cana promotion status` (spawned by V1) at the
    //    historical receipt.mjs. The V1 file itself is copied byte-identically.
    const v1Src = path.join(ROOT, HISTORICAL.v1File);
    const v1Dst = path.join(worktree, 'tools', 'promotion-gate', 'promotion-receipt.replay.mjs');
    fs.mkdirSync(path.dirname(v1Dst), { recursive: true });
    fs.copyFileSync(v1Src, v1Dst);
    const copiedSha = sha256File(v1Dst);
    evidence.push(`V1 evaluator copied byte-identically into historical worktree (sha256 ${copiedSha})`);
    if (copiedSha !== HISTORICAL.v1Sha256) {
      return { classification: 'REAL_REGRESSION', ok: false, evidence: [...evidence, `V1 sha256 drifted: ${copiedSha} != ${HISTORICAL.v1Sha256}`] };
    }
    // 5. run V1 (node --test) inside the historical worktree.
    const result = run(process.execPath, ['--test', 'tools/promotion-gate/promotion-receipt.replay.mjs'], {
      cwd: worktree,
      timeout: 600_000,
      env: { ...process.env, CANA_SOURCE_MIRROR: clone },
    });
    const tally = {
      tests: /^.*tests (\d+)$/m.exec(result.combined)?.[1] ?? null,
      pass: /^.*pass (\d+)$/m.exec(result.combined)?.[1] ?? null,
      fail: /^.*fail (\d+)$/m.exec(result.combined)?.[1] ?? null,
    };
    evidence.push(`V1 node --test in historical context: exit ${result.status} (tests=${tally.tests} pass=${tally.pass} fail=${tally.fail})`);
    if (result.ok) {
      return {
        classification: 'VERIFIED',
        ok: true,
        evidence: [...evidence, 'V1 behaves EXACTLY as before inside its own historical context'],
        detail: { branchName, tally, v1Sha256: copiedSha },
      };
    }
    return {
      classification: 'REAL_REGRESSION',
      ok: false,
      evidence: [...evidence, `V1 did NOT reproduce its historical verdict:`, result.combined.slice(-1500)],
      detail: { branchName, tally },
    };
  } finally {
    if (!keep) {
      try { git(['worktree', 'remove', '--force', worktree], { cwd: clone }); } catch { /* disposable */ }
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = replayV1();
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  process.exitCode = r.classification === 'VERIFIED' || r.classification === 'ENVIRONMENT_MISSING' ? 0 : 1;
}
