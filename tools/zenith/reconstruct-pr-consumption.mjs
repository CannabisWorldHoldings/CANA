#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { canonicalJson, canonicalizePrConsumption, writeExclusiveOutputs } from './reconstruction-contracts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REQUIRED_PR_NUMBERS = Object.freeze([11, 21, 22, 23, 24, 25, 26, 27]);
const LEDGER_SCHEMA_VERSION = 'zenith-pr-consumption-ledger/v1';
const NORMALIZED_CAPTURE_SCHEMA_VERSION = 'zenith-pr-captured-input/v2';
const CAPTURE_SOURCE_PATH = 'docs/zenith/CURRENT_STATE_PR_CAPTURE.json';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_REF_NAME = /^(?!.*(?:^|\/)\.\.?\/?)(?!.*\.\.)(?!.*[~^:?*\[\\])[A-Za-z0-9._/-]+$/;

export class PrConsumptionIdentityError extends Error {
  constructor(detail) {
    super(`PR_CONSUMPTION_IDENTITY_MISMATCH: ${detail}`);
    this.name = 'PrConsumptionIdentityError';
    this.code = 'PR_CONSUMPTION_IDENTITY_MISMATCH';
  }
}

const mismatch = (detail) => { throw new PrConsumptionIdentityError(detail); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function git(repo, args, { binary = false, allowFailure = false } = {}) {
  const result = spawnSync('git', [`--git-dir=${repo}`, ...args], {
    encoding: binary ? null : 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    mismatch(`git ${args[0]} failed: ${String(result.stderr).trim()}`);
  }
  return result;
}

function gitText(repo, args, options) {
  return String(git(repo, args, options).stdout).trim();
}

function requireBareStore(repo) {
  if (gitText(repo, ['rev-parse', '--is-bare-repository']) !== 'true') {
    mismatch('--repo must identify an explicit local bare Git object store');
  }
}

function canonicalTime(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) mismatch(`${field} is invalid`);
  return parsed.toISOString();
}

function requireCaptureShape(capture) {
  if (!capture || typeof capture !== 'object' || !Array.isArray(capture.open_prs)) {
    mismatch('capture must contain open_prs');
  }
  const byNumber = new Map();
  for (const pr of capture.open_prs) {
    if (!Number.isSafeInteger(pr?.number) || pr.number < 1 || byNumber.has(pr.number)) mismatch('capture PR numbers must be unique positive integers');
    if (!HEX40.test(pr.head_sha ?? '')) mismatch(`PR #${pr.number} has no exact head SHA`);
    if (typeof pr.base !== 'string' || !SAFE_REF_NAME.test(pr.base)) mismatch(`PR #${pr.number} has an unsafe base ref`);
    byNumber.set(pr.number, pr);
  }
  for (const number of REQUIRED_PR_NUMBERS) {
    if (!byNumber.has(number)) mismatch(`required captured open PR #${number} is missing`);
  }
  return canonicalTime(capture.captured_at, 'capture captured_at');
}

function resolveCommit(repo, ref, label) {
  const commit = gitText(repo, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!HEX40.test(commit)) mismatch(`${label} did not resolve to an exact commit`);
  return commit;
}

function commitTree(repo, commit, label) {
  const tree = gitText(repo, ['show', '-s', '--format=%T', commit]);
  if (!HEX40.test(tree)) mismatch(`${label} tree is invalid`);
  return tree;
}

function isAncestor(repo, ancestor, descendant) {
  const result = git(repo, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  mismatch(`ancestry check failed for ${ancestor} and ${descendant}: ${String(result.stderr).trim()}`);
}

function changedPaths(repo, baseSha, headSha) {
  const output = git(repo, ['diff', '--name-only', '-z', baseSha, headSha], { binary: true }).stdout;
  return output.toString('utf8').split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function treeEntries(repo, commit) {
  const output = git(repo, ['ls-tree', '-r', '-z', commit], { binary: true }).stdout.toString('utf8');
  const entries = new Map();
  for (const record of output.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    if (tab < 0) mismatch(`invalid tree entry at ${commit}`);
    const [mode, type, object] = record.slice(0, tab).split(' ');
    entries.set(record.slice(tab + 1), { mode, type, object });
  }
  return entries;
}

function mainBlobPaths(entries) {
  const index = new Map();
  for (const [entryPath, entry] of entries) {
    if (entry.type !== 'blob' || !HEX40.test(entry.object)) continue;
    const paths = index.get(entry.object) ?? [];
    paths.push(entryPath);
    index.set(entry.object, paths);
  }
  for (const paths of index.values()) paths.sort((a, b) => a.localeCompare(b));
  return index;
}

function blobDigests(repo, blobShas) {
  const unique = [...new Set(blobShas)].sort();
  if (unique.length === 0) return new Map();
  const result = spawnSync('git', [`--git-dir=${repo}`, 'cat-file', '--batch'], {
    input: Buffer.from(`${unique.join('\n')}\n`),
    encoding: null,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) mismatch(`git cat-file --batch failed: ${String(result.stderr).trim()}`);
  const digests = new Map();
  let offset = 0;
  for (const requested of unique) {
    const headerEnd = result.stdout.indexOf(10, offset);
    if (headerEnd < 0) mismatch(`missing batch header for blob ${requested}`);
    const [object, type, sizeText] = result.stdout.subarray(offset, headerEnd).toString('utf8').split(' ');
    const size = Number(sizeText);
    if (object !== requested || type !== 'blob' || !Number.isSafeInteger(size) || size < 0) mismatch(`invalid batch identity for blob ${requested}`);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= result.stdout.length || result.stdout[contentEnd] !== 10) mismatch(`truncated batch content for blob ${requested}`);
    digests.set(requested, sha256(result.stdout.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  return digests;
}

function originalCaptureIdentity(capture) {
  if (capture.schema_version === NORMALIZED_CAPTURE_SCHEMA_VERSION) {
    const identity = capture.original_capture;
    if (!identity || typeof identity.schema_version !== 'string' || !HEX64.test(identity.canonical_sha256 ?? '')) {
      mismatch('normalized capture must preserve the original capture canonical identity');
    }
    return { schema_version: identity.schema_version, canonical_sha256: identity.canonical_sha256 };
  }
  return {
    schema_version: capture.schema_version ?? 'UNKNOWN',
    canonical_sha256: sha256(Buffer.from(canonicalJson(capture))),
  };
}

export function buildNormalizedCapture({ capture, repo }) {
  requireBareStore(repo);
  const observedAt = requireCaptureShape(capture);
  const originalCapture = originalCaptureIdentity(capture);
  if (capture.schema_version === NORMALIZED_CAPTURE_SCHEMA_VERSION) {
    if (capture.authority_effect !== 'NONE' || !Array.isArray(capture.external_effects) || capture.external_effects.length !== 0) {
      mismatch('normalized capture must declare authority_effect NONE and zero external effects');
    }
    if (canonicalTime(capture.observed_at, 'capture observed_at') !== observedAt) mismatch('normalized capture observed_at must equal captured_at');
  }

  const openPrs = [...capture.open_prs].sort((a, b) => a.number - b.number).map((pr) => {
    const refHead = resolveCommit(repo, `refs/pull/${pr.number}/head`, `PR #${pr.number} head ref`);
    if (refHead !== pr.head_sha) mismatch(`PR #${pr.number} captured head ${pr.head_sha} != refs/pull/${pr.number}/head ${refHead}`);
    const baseSha = pr.base_sha === undefined
      ? resolveCommit(repo, `refs/heads/${pr.base}`, `PR #${pr.number} base ref`)
      : resolveCommit(repo, pr.base_sha, `PR #${pr.number} captured base`);
    if (pr.base_sha !== undefined && pr.base_sha !== baseSha) mismatch(`PR #${pr.number} captured base SHA is not an exact commit`);
    const headTree = commitTree(repo, pr.head_sha, `PR #${pr.number} head`);
    if (pr.head_tree !== undefined && pr.head_tree !== headTree) mismatch(`PR #${pr.number} captured head tree ${pr.head_tree} != ${headTree}`);
    return {
      number: pr.number,
      base: pr.base,
      base_sha: baseSha,
      head: pr.head,
      head_sha: pr.head_sha,
      head_tree: headTree,
      draft: Boolean(pr.draft),
      merge_state: pr.merge_state ?? 'UNKNOWN',
    };
  });

  return {
    schema_version: NORMALIZED_CAPTURE_SCHEMA_VERSION,
    source_schema_version: originalCapture.schema_version,
    captured_at: observedAt,
    observed_at: observedAt,
    authority_effect: 'NONE',
    external_effects: [],
    original_capture: originalCapture,
    repository: {
      name_with_owner: capture.repository?.name_with_owner ?? 'UNKNOWN',
      remote_origin: capture.repository?.remote_origin ?? 'UNKNOWN',
    },
    open_prs: openPrs,
  };
}

export function normalizedCaptureBytes(capture) {
  if (capture?.schema_version !== NORMALIZED_CAPTURE_SCHEMA_VERSION) mismatch('normalized capture schema is required for byte identity');
  return Buffer.from(stableJson(capture));
}

function dispositionFor({ headBlobSha, mainPaths, headIsAncestor }) {
  const matches = mainPaths.get(headBlobSha);
  if (matches?.length) return { disposition: 'CONSUMED_EXACT', consumingPath: matches[0], reasonCode: 'EXACT_BLOB_PRESENT_ON_MAIN' };
  if (headIsAncestor) return { disposition: 'SUPERSEDED', reasonCode: 'HEAD_ANCESTOR_BLOB_ABSENT_ON_MAIN' };
  return { disposition: 'PENDING_REVIEW', reasonCode: 'EXACT_OBJECT_PENDING_REVIEW' };
}

function dispositionReason({ disposition, reasonCode, mergeState, mainSha, consumingPath }) {
  if (disposition === 'UNRESOLVED_OBJECT') {
    return `${reasonCode}; the exact head object is unresolved, so no consumption or discard claim is made.`;
  }
  if (disposition === 'CONSUMED_EXACT') {
    return `Exact head blob is present in current main ${mainSha} at lexicographically first exact blob match ${consumingPath}; no filename-only inference was used.`;
  }
  if (disposition === 'SUPERSEDED') {
    return `PR head is an ancestor of current main ${mainSha}, but this exact head blob is absent from the main tree; the path is superseded, not discarded.`;
  }
  return `Exact objects are locally proven, but consumption is not; captured merge state ${mergeState ?? 'UNKNOWN'} is review evidence and is not itself discard evidence.`;
}

export function buildPrConsumptionLedger({ capture, captureBytes, repo }) {
  requireBareStore(repo);
  const normalized = buildNormalizedCapture({ capture, repo });
  const stableCaptureBytes = normalizedCaptureBytes(normalized);
  if (capture.schema_version === NORMALIZED_CAPTURE_SCHEMA_VERSION && captureBytes !== undefined && !Buffer.from(captureBytes).equals(stableCaptureBytes)) {
    mismatch('normalized capture file bytes differ from stable committed JSON bytes');
  }
  const captureDigest = sha256(stableCaptureBytes);
  const observedAt = normalized.observed_at;
  const mainSha = resolveCommit(repo, 'refs/heads/main', 'current main');
  const mainPaths = mainBlobPaths(treeEntries(repo, mainSha));
  const rows = [];
  const reasons = [];

  for (const pr of normalized.open_prs) {
    const paths = changedPaths(repo, pr.base_sha, pr.head_sha);
    if (paths.length === 0) mismatch(`PR #${pr.number} has no exact changed paths between captured base ${pr.base_sha} and head ${pr.head_sha}`);
    const entries = treeEntries(repo, pr.head_sha);
    const digests = blobDigests(repo, paths.map((changedPath) => entries.get(changedPath)).filter((entry) => entry?.type === 'blob').map((entry) => entry.object));
    const headIsAncestor = isAncestor(repo, pr.head_sha, mainSha);

    for (const changedPath of paths) {
      const entry = entries.get(changedPath);
      const resolved = entry?.type === 'blob' && HEX40.test(entry.object) && digests.has(entry.object);
      const headBlobSha = resolved ? entry.object : 'UNRESOLVED';
      const contentDigest = resolved ? digests.get(entry.object) : 'UNRESOLVED';
      const resolution = resolved
        ? dispositionFor({ headBlobSha, mainPaths, headIsAncestor })
        : { disposition: 'UNRESOLVED_OBJECT', reasonCode: entry ? 'HEAD_ENTRY_NOT_BLOB' : 'PATH_ABSENT_AT_HEAD' };
      const id = `prc_${pr.number}_${sha256(Buffer.from(changedPath)).slice(0, 16)}`;
      const row = canonicalizePrConsumption({
        schema_version: 'zenith-reconstruction/v1',
        id,
        source_kind: 'RECEIPT',
        source_identity: pr.head_sha,
        source_digest: captureDigest,
        source_path: CAPTURE_SOURCE_PATH,
        observed_at: observedAt,
        epistemic_state: resolution.disposition === 'CONSUMED_EXACT' || resolution.disposition === 'SUPERSEDED'
          ? 'OBSERVED'
          : resolution.disposition === 'UNRESOLVED_OBJECT' ? 'UNKNOWN' : 'REVIEW_REQUIRED',
        owner: 'UNKNOWN',
        evidence_refs: [
          { ref: CAPTURE_SOURCE_PATH, digest: captureDigest },
          ...(contentDigest === 'UNRESOLVED' ? [] : [{ ref: `git:${headBlobSha}`, digest: contentDigest }]),
        ],
        authority_effect: 'NONE',
        pr_number: pr.number,
        pr_head_sha: pr.head_sha,
        pr_base_sha: pr.base_sha,
        pr_head_tree: pr.head_tree,
        changed_path: changedPath,
        head_blob_sha: headBlobSha,
        content_digest: contentDigest,
        disposition: resolution.disposition,
        ...(resolution.disposition === 'CONSUMED_EXACT' ? {
          consuming_commit: mainSha,
          consuming_path: resolution.consumingPath,
        } : {}),
      });
      rows.push(row);
      reasons.push({
        id,
        reason_code: resolution.reasonCode,
        reason: dispositionReason({ ...resolution, mergeState: pr.merge_state, mainSha }),
      });
    }
  }

  rows.sort((a, b) => a.pr_number - b.pr_number || a.changed_path.localeCompare(b.changed_path));
  reasons.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    capture: {
      schema_version: normalized.schema_version,
      source_schema_version: normalized.source_schema_version,
      captured_at: normalized.captured_at,
      observed_at: observedAt,
      source_path: CAPTURE_SOURCE_PATH,
      original_capture_canonical_sha256: normalized.original_capture.canonical_sha256,
      normalized_capture_sha256: captureDigest,
      repository: normalized.repository.name_with_owner,
      main_sha: mainSha,
      authority_effect: 'NONE',
      external_effects: [],
    },
    policy: {
      authority_effect: 'NONE',
      external_effects: [],
      consumption_requires_exact_object_proof: true,
      filename_only_inference_forbidden: true,
      red_or_dirty_state_is_not_discard_evidence: true,
      main_ref: 'refs/heads/main',
    },
    pr_consumptions: rows,
    disposition_reasons: reasons,
  };
}

export function verifyPrConsumptionLedger({ capture, captureBytes, repo, ledger }) {
  const expected = buildPrConsumptionLedger({ capture, captureBytes, repo });
  if (canonicalJson(ledger) !== canonicalJson(expected)) mismatch('ledger source, SHA, tree, blob, content, consuming path/commit, disposition, or evidence identity differs from the bare object store');
  return expected;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--capture', '--repo', '--output'].includes(key) || !value) mismatch('usage: reconstruct-pr-consumption.mjs --capture <receipt-or-normalized-capture.json> --repo <bare.git> --output <ledger.json>');
    parsed[key.slice(2)] = value;
  }
  if (!parsed.capture || !parsed.repo || !parsed.output) mismatch('--capture, --repo, and --output are required');
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputBytes = await readFile(args.capture);
  const capture = JSON.parse(inputBytes.toString('utf8'));
  const normalized = buildNormalizedCapture({ capture, repo: args.repo });
  const captureOutputBytes = normalizedCaptureBytes(normalized);
  if (capture.schema_version === NORMALIZED_CAPTURE_SCHEMA_VERSION && !inputBytes.equals(captureOutputBytes)) {
    mismatch('normalized capture input bytes are not the exact stable JSON encoding');
  }
  const ledger = buildPrConsumptionLedger({ capture: normalized, captureBytes: captureOutputBytes, repo: args.repo });
  verifyPrConsumptionLedger({ capture: normalized, captureBytes: captureOutputBytes, repo: args.repo, ledger });
  writeExclusiveOutputs({
    root: ROOT,
    outputs: [
      { outputPath: path.join(path.dirname(args.output), path.basename(CAPTURE_SOURCE_PATH)), bytes: captureOutputBytes },
      { outputPath: args.output, bytes: stableJson(ledger) },
    ],
  });
  const counts = Object.fromEntries([...new Set(ledger.pr_consumptions.map((row) => row.disposition))].sort().map((disposition) => [
    disposition,
    ledger.pr_consumptions.filter((row) => row.disposition === disposition).length,
  ]));
  process.stdout.write(`pr_consumption_rows=${ledger.pr_consumptions.length}\n`);
  for (const [disposition, count] of Object.entries(counts)) process.stdout.write(`${disposition}=${count}\n`);
  process.stdout.write(`output=${path.resolve(args.output)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.code ?? error.name ?? 'ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
