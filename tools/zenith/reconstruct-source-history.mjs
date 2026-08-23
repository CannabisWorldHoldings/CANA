#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, canonicalizeSourceHistoryEdge, canonicalizeSourceHistoryNode, digestCanonical, writeExclusiveOutputs } from './reconstruction-contracts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SHA40 = /^[0-9a-f]{40}$/;
const INPUT_SCHEMA = 'zenith-donor-scan-inputs/v1';
const HISTORY_SCHEMA = 'zenith-source-history-projection/v1';
const INSPECTION_SCHEMA = 'zenith-donor-inspection/v2';
const EFFECTS = Object.freeze({ network: false, canonical_ref_writes: false, archive_code_execution: false, production_mutation: false });
const INPUT_EFFECTS = Object.freeze({ network: false, canonical_ref_writes: false, archive_code_execution: false });
const TEXT_EXTENSIONS = ['.csv', '.json', '.jsonl', '.md', '.toml', '.txt', '.xml', '.yaml', '.yml'];

function refuse(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const sha256Buffer = (value) => createHash('sha256').update(value).digest('hex');
const sha256File = (filename) => sha256Buffer(readFileSync(filename));

function validateSha(sha, field) {
  if (typeof sha !== 'string' || !SHA40.test(sha)) refuse('SHA_INVALID', `${field} must be a full lowercase SHA-1`);
  return sha;
}

function validateLogicalPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)
    || value.startsWith('./') || path.posix.normalize(value) !== value || value.split('/').includes('..')) {
    refuse('PATH_NOT_ROOT_RELATIVE', String(value));
  }
  return value;
}

function validateLabel(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192 || value.includes('\0')) refuse('LABEL_UNSAFE', String(value));
  return value;
}

function resolveContainer(artifactRoot, logicalPath) {
  validateLogicalPath(logicalPath);
  if (!path.isAbsolute(artifactRoot)) refuse('ARTIFACT_ROOT_ABSOLUTE_REQUIRED', artifactRoot);
  if (lstatSync(artifactRoot).isSymbolicLink()) refuse('ARTIFACT_ROOT_SYMLINK_FORBIDDEN', artifactRoot);
  const root = realpathSync(artifactRoot);
  let current = root;
  for (const component of logicalPath.split('/')) {
    current = path.join(current, component);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) refuse('CONTAINER_SYMLINK_FORBIDDEN', logicalPath);
  }
  const resolved = realpathSync(current);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) refuse('CONTAINER_ESCAPE_FORBIDDEN', logicalPath);
  if (!statSync(resolved).isFile()) refuse('CONTAINER_FILE_REQUIRED', logicalPath);
  return resolved;
}

function unsafeMemberReason(name) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\\') || name.includes('\0')) return 'INVALID_PATH';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'ABSOLUTE_PATH';
  if (name.split('/').includes('..')) return 'PARENT_TRAVERSAL';
  if (name.split('/').includes('__MACOSX') || name.split('/').some((part) => part.startsWith('._'))) return 'APPLEDOUBLE';
  return null;
}

function archiveKindFor(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return 'ZIP_ARCHIVE';
  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'TAR_ARCHIVE';
  return null;
}

const isTextMetadata = (name) => TEXT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

function listArchive(filename, kind) {
  const script = kind === 'ZIP_ARCHIVE'
    ? ['import json,stat,sys,zipfile', 'with zipfile.ZipFile(sys.argv[1]) as z:', ' rows=[]', ' for n,i in enumerate(z.infolist()):', '  mode=(i.external_attr >> 16) & 0o170000', '  typ="directory" if i.is_dir() else ("link" if mode == stat.S_IFLNK else "file")', '  rows.append({"index":n,"name":i.filename,"size":i.file_size,"type":typ})', ' print(json.dumps(rows))'].join('\n')
    : ['import json,sys,tarfile', 'with tarfile.open(sys.argv[1], "r:*") as t:', ' rows=[]', ' for n,i in enumerate(t.getmembers()):', '  typ="directory" if i.isdir() else ("file" if i.isfile() else "link_or_special")', '  rows.append({"index":n,"name":i.name,"size":i.size,"type":typ})', ' print(json.dumps(rows))'].join('\n');
  const listed = run('python3', ['-c', script, filename]);
  if (listed.status !== 0) return { error: (listed.stderr || listed.stdout).trim() || 'archive listing failed', members: [] };
  try { return { members: JSON.parse(listed.stdout) }; } catch { return { error: 'archive listing returned invalid JSON', members: [] }; }
}

function extractMembersBatch(filename, kind, targets) {
  if (targets.length === 0) return;
  const script = kind === 'ZIP_ARCHIVE'
    ? [
      'import json,shutil,sys,zipfile',
      'targets=json.loads(sys.argv[2])',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      ' infos=z.infolist()',
      ' for row in targets:',
      '  with z.open(infos[row["index"]]) as source, open(row["destination"], "wb") as target: shutil.copyfileobj(source,target)',
    ].join('\n')
    : [
      'import json,shutil,sys,tarfile',
      'targets=json.loads(sys.argv[2])',
      'with tarfile.open(sys.argv[1], "r:*") as t:',
      ' members=t.getmembers()',
      ' for row in targets:',
      '  source=t.extractfile(members[row["index"]])',
      '  assert source is not None',
      '  with source, open(row["destination"], "wb") as target: shutil.copyfileobj(source,target)',
    ].join('\n');
  const extracted = run('python3', ['-c', script, filename, JSON.stringify(targets)]);
  if (extracted.status !== 0) refuse('MEMBER_BATCH_READ_FAILED', (extracted.stderr || extracted.stdout).trim() || filename);
}

export function inspectBundle(filename, { label, wantedShas = [] }) {
  validateLabel(label);
  wantedShas.forEach((sha) => validateSha(sha, 'wanted donor'));
  const temp = mkdtempSync(path.join(os.tmpdir(), 'zenith-bundle-verify-'));
  try {
    execFileSync('git', ['init', '--bare', '-q', temp]);
    const verified = run('git', [`--git-dir=${temp}`, 'bundle', 'verify', filename]);
    if (verified.status !== 0) {
      return {
        label, byte_size: statSync(filename).size, sha256: sha256File(filename), verification_status: 'REJECTED_VERIFICATION_FAILED', advertised_heads: [],
        matched_advertised_donors: [], non_advertised_wanted_shas: [...wantedShas].sort(), contained_wanted_shas: [],
        contained_non_advertised_wanted_shas: [], non_contained_wanted_shas: [...wantedShas].sort(),
        object_inspection_status: 'NOT_ATTEMPTED_VERIFICATION_FAILED',
        donor_dispositions: wantedShas.map((sha) => ({ sha, admission: 'UNRESOLVED_UNVERIFIED_BUNDLE' })).sort((a, b) => a.sha.localeCompare(b.sha)),
        verification_detail: 'bundle verification failed in a fresh disposable bare Git store; donor membership is unresolved',
      };
    }
    const headsResult = run('git', ['bundle', 'list-heads', filename]);
    if (headsResult.status !== 0) refuse('BUNDLE_HEAD_LIST_FAILED', label);
    const advertisedHeads = headsResult.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const separator = line.indexOf(' ');
      return { sha: line.slice(0, separator), ref: line.slice(separator + 1) };
    }).sort((a, b) => a.sha.localeCompare(b.sha) || a.ref.localeCompare(b.ref));
    const advertised = new Set(advertisedHeads.map((head) => head.sha));
    const unbundled = run('git', [`--git-dir=${temp}`, 'bundle', 'unbundle', filename]);
    if (unbundled.status !== 0) {
      return {
        label, byte_size: statSync(filename).size, sha256: sha256File(filename), verification_status: 'VERIFIED', advertised_heads: advertisedHeads,
        matched_advertised_donors: wantedShas.filter((sha) => advertised.has(sha)).sort(),
        non_advertised_wanted_shas: wantedShas.filter((sha) => !advertised.has(sha)).sort(),
        contained_wanted_shas: [], contained_non_advertised_wanted_shas: [], non_contained_wanted_shas: [...wantedShas].sort(),
        object_inspection_status: 'INCOMPLETE_UNBUNDLE_FAILED',
        object_inspection_detail: 'bundle object inspection in the fresh disposable bare Git store failed; donor membership is unresolved',
        donor_dispositions: wantedShas.map((sha) => ({ sha, admission: 'UNRESOLVED_OBJECT_INSPECTION' })).sort((a, b) => a.sha.localeCompare(b.sha)),
        verification_detail: 'bundle verified in a fresh disposable bare Git store; object inspection could not complete',
      };
    }
    const contained = new Set(wantedShas.filter((sha) => run('git', [`--git-dir=${temp}`, 'cat-file', '-e', `${sha}^{commit}`]).status === 0));
    return {
      label, byte_size: statSync(filename).size, sha256: sha256File(filename), verification_status: 'VERIFIED', advertised_heads: advertisedHeads,
      matched_advertised_donors: wantedShas.filter((sha) => advertised.has(sha)).sort(),
      non_advertised_wanted_shas: wantedShas.filter((sha) => !advertised.has(sha)).sort(),
      contained_wanted_shas: wantedShas.filter((sha) => contained.has(sha)).sort(),
      contained_non_advertised_wanted_shas: wantedShas.filter((sha) => contained.has(sha) && !advertised.has(sha)).sort(),
      non_contained_wanted_shas: wantedShas.filter((sha) => !contained.has(sha)).sort(),
      object_inspection_status: 'COMPLETE',
      object_inspection_detail: 'objects unbundled only into the fresh disposable bare Git store and queried with cat-file; no candidate or canonical refs or objects were touched',
      donor_dispositions: wantedShas.map((sha) => ({
        sha,
        admission: advertised.has(sha) ? 'EXACT_ADVERTISED' : contained.has(sha) ? 'EXACT_CONTAINED_NON_ADVERTISED' : 'REJECTED_NOT_CONTAINED',
      })).sort((a, b) => a.sha.localeCompare(b.sha)),
      verification_detail: 'bundle verified and object-inspected in a fresh disposable bare Git store; no candidate or canonical refs or objects were imported',
    };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

function defaultBudget() {
  return { max_depth: 4, max_containers: 256, max_members: 250000, max_total_uncompressed_bytes: 4294967296, max_member_bytes: 536870912, max_text_member_bytes: 4194304, max_total_text_bytes: 134217728 };
}

function validateBudget(value) {
  const budget = value ?? defaultBudget();
  for (const key of Object.keys(defaultBudget())) if (!Number.isSafeInteger(budget[key]) || budget[key] < 1) refuse('SCAN_BUDGET_INVALID', key);
  return { ...budget };
}

function freshScanContext(wantedShas, budget) {
  return {
    wantedShas, budget: validateBudget(budget),
    stats: { containers_seen: 0, archive_containers: 0, bundles_inspected: 0, members_listed: 0, safe_members: 0, rejected_members: 0, quarantined_members: 0, listed_uncompressed_bytes: 0, extracted_bytes: 0, text_bytes_scanned: 0, text_members_scanned: 0 },
    limitations: [], scanComplete: true, temp: mkdtempSync(path.join(os.tmpdir(), 'zenith-donor-scan-')), serial: 0,
  };
}

function budgetRefusal(context, code, detail) {
  context.scanComplete = false;
  context.limitations.push(`${code}:${detail}`);
}

function prepareRelevantMembers(filename, kind, members, context, label) {
  const prepared = new Map();
  const skipped = new Set();
  const targets = [];
  let reservedBytes = 0;
  let reservedTextBytes = 0;
  for (const member of members) {
    if (unsafeMemberReason(member.name) || member.type !== 'file') continue;
    const relevant = member.name.toLowerCase().endsWith('.bundle') || archiveKindFor(member.name) || isTextMetadata(member.name);
    if (!relevant) continue;
    if (isTextMetadata(member.name) && member.size > context.budget.max_text_member_bytes) {
      budgetRefusal(context, 'TEXT_MEMBER_BYTE_BUDGET_EXCEEDED', `${label}!/${member.name}`);
      skipped.add(member.index);
      continue;
    }
    if (isTextMetadata(member.name) && context.stats.text_bytes_scanned + reservedTextBytes + member.size > context.budget.max_total_text_bytes) {
      budgetRefusal(context, 'TEXT_BYTE_BUDGET_EXCEEDED', `${label}!/${member.name}`);
      skipped.add(member.index);
      continue;
    }
    if (member.size > context.budget.max_member_bytes) {
      budgetRefusal(context, 'MEMBER_BYTE_BUDGET_EXCEEDED', `${label}!/${member.name}`);
      skipped.add(member.index);
      continue;
    }
    if (context.stats.extracted_bytes + reservedBytes + member.size > context.budget.max_total_uncompressed_bytes) {
      budgetRefusal(context, 'TOTAL_BYTE_BUDGET_EXCEEDED', `${label}!/${member.name}`);
      skipped.add(member.index);
      continue;
    }
    const destination = path.join(context.temp, `${context.serial += 1}.member`);
    targets.push({ index: member.index, destination });
    prepared.set(member.index, destination);
    reservedBytes += member.size;
    if (isTextMetadata(member.name)) reservedTextBytes += member.size;
  }
  extractMembersBatch(filename, kind, targets);
  context.stats.extracted_bytes += reservedBytes;
  return { prepared, skipped };
}

function inspectArchiveRecursive(filename, { label, kind, depth, context }) {
  validateLabel(label);
  context.stats.containers_seen += 1;
  context.stats.archive_containers += 1;
  const base = { label, kind, depth, byte_size: statSync(filename).size, sha256: sha256File(filename), archive_safety: 'UNKNOWN', member_count: 0, safe_member_count: 0, rejected_members: [], quarantined_members: [], bundle_members: [], nested_containers: [], text_sha_hits: [], matched_advertised_donors: [], scan_complete: true };
  if (context.stats.containers_seen > context.budget.max_containers) { budgetRefusal(context, 'CONTAINER_BUDGET_EXCEEDED', label); return { ...base, archive_safety: 'REJECTED_BUDGET', scan_complete: false }; }
  if (depth > context.budget.max_depth) { budgetRefusal(context, 'DEPTH_BUDGET_EXCEEDED', label); return { ...base, archive_safety: 'REJECTED_BUDGET', scan_complete: false }; }
  const listing = listArchive(filename, kind);
  if (listing.error) { context.scanComplete = false; context.limitations.push(`LISTING_FAILED:${label}`); return { ...base, archive_safety: 'REJECTED_LISTING_FAILED', listing_detail: listing.error, scan_complete: false }; }
  base.member_count = listing.members.length;
  context.stats.members_listed += listing.members.length;
  context.stats.listed_uncompressed_bytes += listing.members.reduce((total, member) => total + member.size, 0);
  if (context.stats.members_listed > context.budget.max_members) { budgetRefusal(context, 'MEMBER_COUNT_BUDGET_EXCEEDED', label); return { ...base, archive_safety: 'REJECTED_BUDGET', scan_complete: false }; }
  const { prepared, skipped } = prepareRelevantMembers(filename, kind, listing.members, context, label);
  if (skipped.size > 0) base.scan_complete = false;
  for (const member of listing.members) {
    const unsafe = unsafeMemberReason(member.name);
    if (unsafe === 'APPLEDOUBLE') { base.quarantined_members.push({ name: member.name, reason: unsafe }); context.stats.quarantined_members += 1; continue; }
    if (unsafe) { base.rejected_members.push({ name: member.name, reason: unsafe }); context.stats.rejected_members += 1; continue; }
    if (member.type === 'directory') continue;
    if (member.type !== 'file') { base.rejected_members.push({ name: member.name, reason: 'ARCHIVE_LINK_OR_SPECIAL' }); context.stats.rejected_members += 1; continue; }
    base.safe_member_count += 1;
    context.stats.safe_members += 1;
    const nestedKind = archiveKindFor(member.name);
    if (member.name.toLowerCase().endsWith('.bundle')) {
      const extracted = prepared.get(member.index);
      if (!extracted) { base.scan_complete = false; continue; }
      base.bundle_members.push(inspectBundle(extracted, { label: `${label}!/${member.name}`, wantedShas: context.wantedShas }));
      context.stats.containers_seen += 1;
      context.stats.bundles_inspected += 1;
      continue;
    }
    if (nestedKind) {
      const extracted = prepared.get(member.index);
      if (!extracted) { base.scan_complete = false; continue; }
      base.nested_containers.push(inspectArchiveRecursive(extracted, { label: `${label}!/${member.name}`, kind: nestedKind, depth: depth + 1, context }));
      continue;
    }
    if (isTextMetadata(member.name)) {
      const extracted = prepared.get(member.index);
      if (!extracted) { base.scan_complete = false; continue; }
      const bytes = readFileSync(extracted);
      const matched = context.wantedShas.filter((sha) => bytes.toString('utf8').includes(sha)).sort();
      context.stats.text_bytes_scanned += bytes.length;
      context.stats.text_members_scanned += 1;
      if (matched.length > 0) base.text_sha_hits.push({ member: member.name, member_sha256: sha256Buffer(bytes), matched_shas: matched });
    }
  }
  base.matched_advertised_donors = [...new Set([...base.bundle_members, ...base.nested_containers].flatMap((row) => row.matched_advertised_donors ?? []))].sort();
  base.scan_complete = base.scan_complete && !base.nested_containers.some((row) => row.scan_complete === false);
  base.archive_safety = base.rejected_members.length > 0 ? 'SAFE_WITH_REJECTIONS' : base.quarantined_members.length > 0 ? 'SAFE_WITH_QUARANTINE' : 'SAFE_LISTING';
  return base;
}

export function inspectArchive(filename, { label, wantedShas = [], kind, budget }) {
  wantedShas.forEach((sha) => validateSha(sha, 'wanted donor'));
  const context = freshScanContext(wantedShas, budget);
  try { return inspectArchiveRecursive(filename, { label, kind: kind ?? archiveKindFor(filename) ?? refuse('ARCHIVE_KIND_INVALID', filename), depth: 0, context }); }
  finally { rmSync(context.temp, { recursive: true, force: true }); }
}

function git(repo, args) {
  const result = run('git', ['-C', repo, ...args]);
  if (result.status !== 0) refuse('GIT_QUERY_FAILED', `${args.join(' ')}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

const commitDigest = (repo, sha) => sha256Buffer(git(repo, ['cat-file', 'commit', sha]));

function sourceNode({ sha, disposition, epistemicState, sourceDigest, observedAt, evidenceDigest }) {
  return canonicalizeSourceHistoryNode({ schema_version: 'zenith-reconstruction/v1', id: `shn_${sha}`, source_kind: 'GIT_COMMIT', source_identity: sha, source_digest: sourceDigest, source_path: `external-evidence/git-commits/${sha}`, observed_at: observedAt, epistemic_state: epistemicState, owner: 'UNKNOWN', evidence_refs: [{ ref: 'docs/zenith/DONOR_INSPECTION_MANIFEST.json', digest: evidenceDigest }], authority_effect: 'NONE', node_kind: 'GIT_COMMIT', content_digest: sourceDigest, descendant_disposition: disposition });
}

function sourceEdge({ from, to, relation, observedAt, evidenceDigest }) {
  const identity = sha256Buffer(`${from}\0${to}\0${relation}`);
  return canonicalizeSourceHistoryEdge({ schema_version: 'zenith-reconstruction/v1', id: `she_${identity.slice(0, 32)}`, source_kind: 'ARTIFACT', source_identity: identity, source_digest: identity, source_path: 'docs/zenith/SOURCE_HISTORY_PROJECTION.json', observed_at: observedAt, epistemic_state: 'OBSERVED', owner: 'UNKNOWN', evidence_refs: [{ ref: 'docs/zenith/DONOR_INSPECTION_MANIFEST.json', digest: evidenceDigest }], authority_effect: 'NONE', from_id: `shn_${from}`, to_id: `shn_${to}`, edge_kind: relation === 'ANCESTOR' ? 'ANCESTOR_OF' : 'NON_ANCESTOR_OF' });
}

function flattenInspections(rows) {
  const flattened = [];
  const visit = (row) => { flattened.push(row); for (const bundle of row.bundle_members ?? []) flattened.push(bundle); for (const nested of row.nested_containers ?? []) visit(nested); };
  rows.forEach(visit);
  return flattened;
}

export function reconstructSourceHistory({ repo, artifactRoot, manifest }) {
  if (!manifest || manifest.schema_version !== INPUT_SCHEMA) refuse('MANIFEST_SCHEMA_INVALID', INPUT_SCHEMA);
  if (manifest.authority_effect !== 'NONE') refuse('AUTHORITY_EFFECT_FORBIDDEN', 'input manifest');
  if (JSON.stringify(manifest.external_effects) !== JSON.stringify(INPUT_EFFECTS)) refuse('EXTERNAL_EFFECTS_INVALID', 'input manifest must explicitly refuse network, ref writes, and archive execution');
  const observedAt = manifest.observed_at;
  if (typeof observedAt !== 'string' || new Date(observedAt).toISOString() !== observedAt) refuse('OBSERVED_TIME_INVALID', 'manifest observed_at');
  const mainSha = validateSha(manifest.main_sha, 'main_sha');
  const wantedDonors = [...(manifest.wanted_donors ?? [])].map((sha) => validateSha(sha, 'wanted donor')).sort();
  const allKnown = [...(manifest.known_commits ?? []), ...(manifest.non_ancestor_commits ?? [])];
  git(repo, ['cat-file', '-e', `${mainSha}^{commit}`]);
  const relations = allKnown.map((entry) => {
    const sha = validateSha(entry.sha, 'known commit');
    if (run('git', ['-C', repo, 'cat-file', '-e', `${sha}^{commit}`]).status !== 0) refuse('KNOWN_COMMIT_MISSING', sha);
    const ancestry = run('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, mainSha]);
    const observedRelation = ancestry.status === 0 ? 'ANCESTOR' : ancestry.status === 1 ? 'NON_ANCESTOR' : refuse('ANCESTRY_QUERY_FAILED', sha);
    if (entry.expected_relation && observedRelation !== entry.expected_relation) refuse('ANCESTRY_EXPECTATION_FAILED', sha);
    return { sha, observed_relation: observedRelation };
  }).sort((a, b) => a.sha.localeCompare(b.sha));
  const context = freshScanContext(wantedDonors, manifest.scan_budget);
  let inspections;
  try {
    inspections = (manifest.containers ?? []).map((container) => {
      const logicalPath = validateLogicalPath(container.logical_path);
      const filename = resolveContainer(artifactRoot, logicalPath);
      if (container.kind === 'BUNDLE') { context.stats.containers_seen += 1; context.stats.bundles_inspected += 1; return { kind: 'BUNDLE', ...inspectBundle(filename, { label: logicalPath, wantedShas: wantedDonors }) }; }
      if (!['ZIP_ARCHIVE', 'TAR_ARCHIVE'].includes(container.kind)) refuse('CONTAINER_KIND_INVALID', String(container.kind));
      return inspectArchiveRecursive(filename, { label: logicalPath, kind: container.kind, depth: 0, context });
    }).sort((a, b) => a.label.localeCompare(b.label));
  } finally { rmSync(context.temp, { recursive: true, force: true }); }
  const flattenedInspections = flattenInspections(inspections);
  const bundleInspections = flattenedInspections.filter((row) => row.kind === 'BUNDLE' || row.verification_status !== undefined);
  context.stats.bundle_object_inspections_complete = bundleInspections.filter((row) => row.object_inspection_status === 'COMPLETE').length;
  context.stats.bundle_object_inspections_incomplete = bundleInspections.length - context.stats.bundle_object_inspections_complete;
  const scanComplete = context.scanComplete
    && inspections.every((row) => row.scan_complete !== false)
    && inspections.length === (manifest.containers ?? []).length
    && bundleInspections.every((row) => row.verification_status === 'VERIFIED' && row.object_inspection_status === 'COMPLETE');
  const inspection = { schema_version: INSPECTION_SCHEMA, observed_at: observedAt, main_sha: mainSha, input_manifest: 'docs/zenith/DONOR_SCAN_INPUTS.json', input_digest: digestCanonical(manifest), scan_complete: scanComplete, scan_budget: context.budget, scan_counts: context.stats, containers: inspections, limitations: [...new Set(context.limitations)].sort(), authority_effect: 'NONE', external_effects: EFFECTS };
  const evidenceDigest = digestCanonical(inspection);
  const advertisedBy = new Map(wantedDonors.map((sha) => [sha, []]));
  const containedBy = new Map(wantedDonors.map((sha) => [sha, []]));
  const textHits = new Map(wantedDonors.map((sha) => [sha, []]));
  for (const row of flattenedInspections) {
    if (row.verification_status === 'VERIFIED') for (const sha of row.matched_advertised_donors ?? []) advertisedBy.get(sha)?.push(row.label);
    if (row.object_inspection_status === 'COMPLETE') for (const sha of row.contained_wanted_shas ?? []) containedBy.get(sha)?.push(row.label);
    for (const hit of row.text_sha_hits ?? []) for (const sha of hit.matched_shas) textHits.get(sha)?.push(`${row.label}!/${hit.member}`);
  }
  const donorRows = wantedDonors.map((sha) => {
    const advertised = [...new Set(advertisedBy.get(sha))].sort();
    const contained = [...new Set(containedBy.get(sha))].sort();
    return {
      sha,
      disposition: contained.length > 0 ? 'CANDIDATE_EXACT' : scanComplete ? 'ABSENT' : 'UNRESOLVED',
      advertised_by: advertised,
      contained_by: contained,
      text_exact_sha_hits: [...new Set(textHits.get(sha))].sort(),
      epistemic_state: contained.length > 0 ? 'OBSERVED' : 'UNKNOWN',
    };
  });
  const mainNode = sourceNode({ sha: mainSha, disposition: 'CANDIDATE_EXACT', epistemicState: 'OBSERVED', sourceDigest: commitDigest(repo, mainSha), observedAt, evidenceDigest });
  const relationNodes = relations.map((row) => sourceNode({ sha: row.sha, disposition: row.observed_relation === 'ANCESTOR' ? 'REUSE_EXISTING' : 'UNRESOLVED', epistemicState: 'OBSERVED', sourceDigest: commitDigest(repo, row.sha), observedAt, evidenceDigest }));
  const donorNodes = donorRows.map((row) => sourceNode({ sha: row.sha, disposition: row.disposition, epistemicState: row.epistemic_state, sourceDigest: sha256Buffer(row.sha), observedAt, evidenceDigest }));
  const nodes = [mainNode, ...relationNodes, ...donorNodes].filter((node, index, rows) => rows.findIndex((candidate) => candidate.id === node.id) === index).sort((a, b) => a.id.localeCompare(b.id));
  const edges = relations.filter((row) => row.sha !== mainSha).map((row) => sourceEdge({ from: row.sha, to: mainSha, relation: row.observed_relation, observedAt, evidenceDigest })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    sourceHistory: { schema_version: HISTORY_SCHEMA, observed_at: observedAt, main_sha: mainSha, relations, nodes, edges, authority_effect: 'NONE', external_effects: EFFECTS },
    dispositions: { schema_version: 'zenith-descendant-disposition/v1', observed_at: observedAt, main_sha: mainSha, scan_complete: scanComplete, known_commits: relations.map((row) => ({ sha: row.sha, relation_to_main: row.observed_relation, disposition: row.observed_relation === 'ANCESTOR' ? 'REUSE_EXISTING' : 'UNRESOLVED' })), donors: donorRows, authority_effect: 'NONE', external_effects: EFFECTS },
    inspection,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!['--repo', '--artifact-root', '--scan-inputs', '--output-dir'].includes(key) || value === undefined) refuse('ARGUMENT_INVALID', key ?? 'missing');
    args[key.slice(2)] = value;
  }
  if (!args.repo || !args['artifact-root'] || !args['scan-inputs'] || !args['output-dir']) refuse('ARGUMENT_REQUIRED', '--repo --artifact-root --scan-inputs --output-dir');
  return args;
}

const canonicalBytes = (value) => `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(args['scan-inputs'], 'utf8'));
  const result = reconstructSourceHistory({ repo: args.repo, artifactRoot: args['artifact-root'], manifest });
  writeExclusiveOutputs({
    root: ROOT,
    outputs: [
      { outputPath: path.join(args['output-dir'], 'SOURCE_HISTORY_PROJECTION.json'), bytes: canonicalBytes(result.sourceHistory) },
      { outputPath: path.join(args['output-dir'], 'DESCENDANT_DISPOSITION.json'), bytes: canonicalBytes(result.dispositions) },
      { outputPath: path.join(args['output-dir'], 'DONOR_INSPECTION_MANIFEST.json'), bytes: canonicalBytes(result.inspection) },
    ],
  });
  process.stdout.write(`${JSON.stringify({ schema_version: HISTORY_SCHEMA, observed_at: manifest.observed_at, scan_complete: result.inspection.scan_complete, containers_scanned: result.inspection.scan_counts.containers_seen, bundles_inspected: result.inspection.scan_counts.bundles_inspected, donors_resolved: result.dispositions.donors.filter((row) => row.disposition === 'CANDIDATE_EXACT').length, donors_absent: result.dispositions.donors.filter((row) => row.disposition === 'ABSENT').length, authority_effect: 'NONE', external_effects: EFFECTS })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
