#!/usr/bin/env node
/**
 * Compiles the inert, evidence-bound reconstruction NeedItem ledger.
 *
 * The manifest records logical source locations and immutable SHA-256 values;
 * it intentionally contains no machine paths, credentials, timestamps from
 * execution, or authority-bearing data. This tool performs no network I/O.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ContractError,
  GATE_KINDS,
  NEED_STATES,
  canonicalJson,
  canonicalizeNeedItem,
  digestCanonical,
  writeExclusiveOutputs,
} from './reconstruction-contracts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CAPABILITY_OWNERS_PATH = path.join(ROOT, 'tools', 'federation', 'capability-owners.json');
const INPUT_SCHEMA_VERSION = 'zenith-need-inputs/v1';
const LEDGER_SCHEMA_VERSION = 'zenith-need-ledger/v1';
const HEX64 = /^[0-9a-f]{64}$/;
const LOGICAL_PATH = (value) => typeof value === 'string'
  && value.length > 0
  && !value.includes('\\')
  && !path.posix.isAbsolute(value)
  && !value.startsWith('./')
  && !value.split('/').includes('..')
  && path.posix.normalize(value) === value;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const fail = (code, detail) => { throw new ContractError(code, detail); };

function requireExactFields(value, allowed, type) {
  if (!isObject(value)) fail('OBJECT_REQUIRED', `${type} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('UNRECOGNIZED_FIELD', `${type}.${key} is not accepted`);
  }
}

function requireLogicalPath(value, field) {
  if (!LOGICAL_PATH(value)) fail('PATH_NOT_REPOSITORY_RELATIVE', `${field} must be a normalized logical repository path`);
  return value;
}

function requireTimestamp(value, field) {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) fail('OBSERVED_TIME_INVALID', `${field} must be canonical ISO-8601 UTC`);
  return value;
}

function requireOwner(value, field) {
  if (value !== 'UNKNOWN' && (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_/-]{1,127}$/.test(value))) {
    fail('OWNER_INVALID', `${field} must be an owner identifier or UNKNOWN`);
  }
  return value;
}

function readRepositoryInput(logicalPath, expectedDigest) {
  const candidate = path.resolve(ROOT, logicalPath);
  if (path.relative(ROOT, candidate).startsWith('..') || path.isAbsolute(path.relative(ROOT, candidate))) {
    fail('INPUT_PATH_ESCAPES_REPOSITORY', `${logicalPath} resolves outside the repository`);
  }

  let cursor = ROOT;
  for (const segment of logicalPath.split('/')) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error && error.code === 'ENOENT') fail('INPUT_FILE_MISSING', `${logicalPath} is not present under the repository root`);
      throw error;
    }
    if (stat.isSymbolicLink()) fail('INPUT_SYMLINK_FORBIDDEN', `${logicalPath} contains a symbolic link`);
  }

  const stat = fs.statSync(candidate);
  if (!stat.isFile()) fail('INPUT_NOT_REGULAR_FILE', `${logicalPath} must be a regular file`);
  const bytes = fs.readFileSync(candidate);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedDigest) fail('INPUT_DIGEST_MISMATCH', `${logicalPath} digest does not match the manifest`);
  if (logicalPath.endsWith('.json')) {
    try {
      JSON.parse(bytes.toString('utf8'));
    } catch {
      fail('INPUT_JSON_INVALID', `${logicalPath} must contain valid JSON`);
    }
  }
  return { logical_path: logicalPath, sha256: expectedDigest };
}

function registeredOwners() {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(CAPABILITY_OWNERS_PATH, 'utf8'));
  } catch {
    fail('CAPABILITY_OWNER_REGISTRY_INVALID', 'capability owner registry must be valid JSON');
  }
  if (!Array.isArray(registry.owners)) fail('CAPABILITY_OWNER_REGISTRY_INVALID', 'capability owner registry must expose owners');
  const owners = new Set(registry.owners.map((entry) => entry?.capability));
  if (owners.has('UNKNOWN')) fail('CAPABILITY_OWNER_REGISTRY_INVALID', 'UNKNOWN is not a registered capability owner');
  return owners;
}

function parseInputs(inputsPath) {
  const source = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
  requireExactFields(source, ['schema_version', 'observed_at', 'inputs', 'needs'], 'need_inputs');
  if (source.schema_version !== INPUT_SCHEMA_VERSION) fail('SCHEMA_VERSION_INVALID', `need inputs require ${INPUT_SCHEMA_VERSION}`);
  requireTimestamp(source.observed_at, 'observed_at');
  if (!Array.isArray(source.inputs) || source.inputs.length === 0) fail('INPUT_REQUIRED', 'inputs must be a non-empty array');
  if (!Array.isArray(source.needs) || source.needs.length === 0) fail('NEED_REQUIRED', 'needs must be a non-empty array');

  const inputs = new Map();
  for (const entry of source.inputs) {
    requireExactFields(entry, ['logical_path', 'sha256', 'source_kind'], 'input');
    const logicalPath = requireLogicalPath(entry.logical_path, 'input.logical_path');
    if (!HEX64.test(entry.sha256)) fail('SOURCE_DIGEST_REQUIRED', `input ${logicalPath} requires a lowercase SHA-256`);
    if (typeof entry.source_kind !== 'string' || entry.source_kind.length === 0) fail('SOURCE_KIND_REQUIRED', `input ${logicalPath} requires source_kind`);
    if (inputs.has(logicalPath)) fail('DUPLICATE_INPUT_PATH', `input ${logicalPath} repeats`);
    inputs.set(logicalPath, { logical_path: logicalPath, sha256: entry.sha256, source_kind: entry.source_kind });
  }
  for (const input of inputs.values()) readRepositoryInput(input.logical_path, input.sha256);
  const owners = registeredOwners();

  const needs = source.needs.map((entry) => {
    requireExactFields(entry, [
      'id', 'need_kind', 'need_state', 'next_gate', 'gate_kind', 'owner',
      'epistemic_state', 'source_logical_path', 'evidence_logical_paths',
    ], 'need');
    if (typeof entry.id !== 'string' || !/^need_[a-z0-9][a-z0-9_-]{1,127}$/.test(entry.id)) fail('STABLE_ID_INVALID', 'need.id must be a stable need_ identifier');
    if (typeof entry.need_kind !== 'string' || entry.need_kind.length === 0) fail('NEED_KIND_REQUIRED', `${entry.id}.need_kind is required`);
    if (!NEED_STATES.includes(entry.need_state)) fail('ENUM_INVALID', `${entry.id}.need_state is invalid`);
    if (typeof entry.next_gate !== 'string' || entry.next_gate.length === 0) fail('NEXT_GATE_REQUIRED', `${entry.id}.next_gate is required`);
    if (!GATE_KINDS.includes(entry.gate_kind)) fail('ENUM_INVALID', `${entry.id}.gate_kind is invalid`);
    requireOwner(entry.owner, `${entry.id}.owner`);
    if (entry.owner !== 'UNKNOWN' && !owners.has(entry.owner)) {
      fail('OWNER_NOT_REGISTERED', `${entry.id}.owner is not in capability-owners.json`);
    }
    if (typeof entry.epistemic_state !== 'string' || entry.epistemic_state.length === 0) fail('EPISTEMIC_STATE_INVALID', `${entry.id}.epistemic_state is required`);
    requireLogicalPath(entry.source_logical_path, `${entry.id}.source_logical_path`);
    if (!Array.isArray(entry.evidence_logical_paths) || entry.evidence_logical_paths.length === 0) fail('EVIDENCE_REQUIRED', `${entry.id}.evidence_logical_paths is required`);
    for (const evidencePath of entry.evidence_logical_paths) requireLogicalPath(evidencePath, `${entry.id}.evidence_logical_paths`);
    return entry;
  });
  const ids = needs.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_ID', 'need ids must be unique');
  return { observed_at: source.observed_at, inputs, needs, manifest_digest: digestCanonical(source) };
}

function sourceKindForContract(sourceKind) {
  return ['GIT_COMMIT', 'GIT_TREE', 'GIT_BLOB', 'GIT_BRANCH', 'ZIP_ARCHIVE', 'TAR_ARCHIVE', 'EXACT_FILE', 'ARTIFACT', 'RECEIPT', 'BUNDLE', 'LOCAL_CANDIDATE'].includes(sourceKind)
    ? sourceKind
    : 'EXACT_FILE';
}

function toNeedItem(entry, inputs, observedAt) {
  const source = inputs.get(entry.source_logical_path);
  const requestedEvidence = entry.evidence_logical_paths.map((logicalPath) => inputs.get(logicalPath)).filter(Boolean);
  const evidenceAvailable = requestedEvidence.length === entry.evidence_logical_paths.length;
  const sourceAvailable = Boolean(source);
  const sourceBound = sourceAvailable && evidenceAvailable;
  const needState = sourceBound ? entry.need_state : 'UNKNOWN';
  const evidence = requestedEvidence.length > 0 ? requestedEvidence : source ? [source] : [];
  // canonicalizeNeedItem requires evidence even when the requested evidence is
  // absent. The manifest itself remains a known immutable input, and retains
  // the failed evidence request in the UNKNOWN state rather than fabricating it.
  const fallbackDigest = digestCanonical({ id: entry.id, manifest: [...inputs.values()].map((input) => [input.logical_path, input.sha256]) });
  const sourceDigest = source?.sha256 ?? fallbackDigest;
  const sourcePath = source?.logical_path ?? 'docs/zenith/NEED_ITEM_INPUTS.json';
  const evidenceRefs = evidence.length > 0
    ? evidence.map((item) => ({ ref: item.logical_path, digest: item.sha256 }))
    : [{ ref: 'docs/zenith/NEED_ITEM_INPUTS.json', digest: fallbackDigest }];
  return canonicalizeNeedItem({
    schema_version: 'zenith-reconstruction/v1',
    id: entry.id,
    source_kind: sourceKindForContract(source?.source_kind),
    source_identity: sourceDigest,
    source_digest: sourceDigest,
    source_path: sourcePath,
    observed_at: observedAt,
    epistemic_state: sourceBound ? entry.epistemic_state : 'UNKNOWN',
    owner: sourceBound ? entry.owner : 'UNKNOWN',
    evidence_refs: evidenceRefs,
    authority_effect: 'NONE',
    need_state: needState,
    need_kind: entry.need_kind,
    next_gate: entry.next_gate,
    gate_kind: entry.gate_kind,
    decision_eligible: needState === 'SATISFIED',
  });
}

export function compileNeedLedger({ inputsPath }) {
  const parsed = parseInputs(inputsPath);
  const needItems = parsed.needs.map((entry) => toNeedItem(entry, parsed.inputs, parsed.observed_at))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    observed_at: parsed.observed_at,
    authority_effect: 'NONE',
    external_effects: {
      credential_reads: 0,
      deployments: 0,
      dns_writes: 0,
      production_mutations: 0,
      public_mutations: 0,
      spend_cents: 0,
    },
    input_manifest_digest: parsed.manifest_digest,
    input_digests: [...parsed.inputs.values()]
      .map(({ logical_path, sha256 }) => ({ logical_path, sha256 }))
      .sort((left, right) => left.logical_path.localeCompare(right.logical_path)),
    need_items: needItems,
  };
}

export function generateNeedLedger({ inputsPath, outputPath }) {
  const ledger = compileNeedLedger({ inputsPath });
  const canonical = canonicalJson(ledger);
  const digest = createHash('sha256').update(canonical).digest('hex');
  writeExclusiveOutputs({
    root: ROOT,
    outputs: [{ outputPath, bytes: `${canonical}\n` }],
  });
  return { ...ledger, digest };
}

function main(argv) {
  const inputIndex = argv.indexOf('--inputs');
  const outputIndex = argv.indexOf('--output');
  const inputsPath = inputIndex >= 0 ? argv[inputIndex + 1] : null;
  const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : null;
  if (!inputsPath || !outputPath || argv.length !== 4) {
    throw new Error('usage: node tools/zenith/reconstruct-needs.mjs --inputs <manifest> --output <path>');
  }
  const result = generateNeedLedger({ inputsPath: path.resolve(ROOT, inputsPath), outputPath: path.resolve(ROOT, outputPath) });
  process.stdout.write(`${canonicalJson({ output: path.relative(ROOT, path.resolve(ROOT, outputPath)), sha256: result.digest, need_items: result.need_items.length })}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
