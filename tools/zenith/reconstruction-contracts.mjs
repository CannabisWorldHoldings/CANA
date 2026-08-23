import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RECONSTRUCTION_SCHEMA_VERSION = 'zenith-reconstruction/v1';

export const EPISTEMIC_STATES = Object.freeze([
  'UNKNOWN',
  'UNVERIFIED',
  'OBSERVED',
  'REVIEW_REQUIRED',
  'CONTRADICTED',
  'PARTIALLY_IMPLEMENTED',
  'PLANNED',
  'RESEARCH_ONLY',
  'BLOCKED',
  'FALSIFIED',
  'VERIFIED_IMPLEMENTED',
  'INPUT_REQUIRED',
  'EMPTY',
  'CAPABILITY_GAP',
]);

export const SOURCE_KINDS = Object.freeze([
  'GIT_COMMIT', 'GIT_TREE', 'GIT_BLOB', 'GIT_BRANCH', 'ZIP_ARCHIVE', 'TAR_ARCHIVE',
  'EXACT_FILE', 'ARTIFACT', 'RECEIPT', 'BUNDLE', 'LOCAL_CANDIDATE',
]);
export const NEED_STATES = Object.freeze(['SATISFIED', 'OPEN', 'BLOCKED_EXTERNAL', 'INPUT_REQUIRED', 'UNKNOWN']);
export const GATE_KINDS = Object.freeze([
  'AUTHORITY', 'CREDENTIAL', 'ACCOUNT', 'SECURITY_RELEASE', 'RUNTIME_COMPATIBILITY',
  'PROVIDER_CAPABILITY', 'TRANSPORT_DECISION', 'BACKUP_ROLLBACK', 'EVIDENCE',
  'CUSTOMER_OUTCOME', 'MERCHANT_OUTCOME', 'INPUT', 'UNKNOWN',
]);
export const PR_CONSUMPTION_DISPOSITIONS = Object.freeze([
  'CANONICAL', 'CONSUMED_EXACT', 'SUPERSEDED', 'REJECTED_DUPLICATE', 'PENDING_REVIEW', 'UNRESOLVED_OBJECT',
]);
export const SOURCE_HISTORY_NODE_KINDS = Object.freeze([...SOURCE_KINDS]);
export const SOURCE_HISTORY_EDGE_KINDS = Object.freeze([
  'DERIVED_FROM', 'CONSUMES', 'SUPERSEDES', 'QUARANTINES', 'EVIDENCES',
  'ADVERTISES', 'CONTAINS', 'ANCESTOR_OF', 'NON_ANCESTOR_OF', 'RESOLVES_TO',
]);
export const DESCENDANT_DISPOSITIONS = Object.freeze([
  'REUSE_EXISTING', 'CANDIDATE_EXACT', 'SUPERSEDED', 'DUPLICATE', 'ABSENT', 'UNRESOLVED',
]);
const ID_PATTERN = /^(?:need|prc|shn|she|zrr)_[a-z0-9][a-z0-9_-]{1,127}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX40_OR_64 = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_/-]{1,127}$/;

export class ContractError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'ContractError';
    this.code = code;
  }
}

const refuse = (code, detail) => { throw new ContractError(code, detail); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const clone = (value) => JSON.parse(JSON.stringify(value));

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) refuse('NON_CANONICAL_VALUE', 'numbers must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  refuse('NON_CANONICAL_VALUE', `unsupported value type ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function digestCanonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function requireOutputRoot(root) {
  if (typeof root !== 'string' || root.length === 0) refuse('OUTPUT_ROOT_INVALID', 'output root is required');
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    refuse('OUTPUT_ROOT_INVALID', 'output root must exist');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) refuse('OUTPUT_ROOT_INVALID', 'output root must be a real directory');
  return fs.realpathSync(root);
}

function outputIsOutsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function requireSafeOutputParent(root, filename) {
  const relativeParent = path.relative(root, path.dirname(filename));
  if (relativeParent === '' || relativeParent === '.') return;
  let cursor = root;
  for (const component of relativeParent.split(path.sep)) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      fs.mkdirSync(cursor);
      stat = fs.lstatSync(cursor);
    }
    if (stat.isSymbolicLink()) refuse('OUTPUT_SYMLINK_FORBIDDEN', `${cursor} is a symbolic link`);
    if (!stat.isDirectory()) refuse('OUTPUT_PARENT_NOT_DIRECTORY', `${cursor} is not a directory`);
    if (outputIsOutsideRoot(root, fs.realpathSync(cursor))) refuse('OUTPUT_PATH_ESCAPES_ROOT', `${filename} escapes the output root`);
  }
}

/**
 * Validates output destinations before any output is written. Each destination
 * is constrained to a real repository root, has no symlink component/final,
 * and must not already exist. Call writeExclusiveOutputs to create them.
 */
export function prepareExclusiveOutputPaths({ root, outputPaths }) {
  const outputRoot = requireOutputRoot(root);
  if (!Array.isArray(outputPaths) || outputPaths.length === 0) refuse('OUTPUT_PATH_REQUIRED', 'at least one output path is required');
  const prepared = [];
  const seen = new Set();
  for (const outputPath of outputPaths) {
    if (typeof outputPath !== 'string' || outputPath.length === 0 || outputPath.includes('\0')) {
      refuse('OUTPUT_PATH_INVALID', 'output path must be a non-empty string');
    }
    const filename = path.resolve(outputRoot, outputPath);
    if (outputIsOutsideRoot(outputRoot, filename)) refuse('OUTPUT_PATH_ESCAPES_ROOT', `${outputPath} is outside the repository root`);
    if (seen.has(filename)) refuse('OUTPUT_DUPLICATE_PATH', `${outputPath} is repeated`);
    seen.add(filename);
    requireSafeOutputParent(outputRoot, filename);
    try {
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) refuse('OUTPUT_SYMLINK_FORBIDDEN', `${outputPath} is a symbolic link`);
      refuse('OUTPUT_ALREADY_EXISTS', `${outputPath} already exists`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    prepared.push(filename);
  }
  return prepared;
}

export function writeExclusiveOutputs({ root, outputs }) {
  if (!Array.isArray(outputs) || outputs.length === 0) refuse('OUTPUT_PATH_REQUIRED', 'at least one output is required');
  const filenames = prepareExclusiveOutputPaths({ root, outputPaths: outputs.map((entry) => entry?.outputPath) });
  for (let index = 0; index < outputs.length; index += 1) {
    try {
      fs.writeFileSync(filenames[index], outputs[index].bytes, { flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') refuse('OUTPUT_ALREADY_EXISTS', `${outputs[index].outputPath} already exists`);
      throw error;
    }
  }
  return filenames;
}

function requireObject(value, field) {
  if (!isObject(value)) refuse('OBJECT_REQUIRED', `${field} must be an object`);
  return value;
}

function requireExactFields(value, allowed, type) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse('UNRECOGNIZED_FIELD', `${type}.${key} is not part of the inert reconstruction contract`);
  }
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    const code = field === 'epistemic_state' && value === 'VERIFIED'
      ? 'VERIFIED_WITHOUT_EVIDENCE'
      : field === 'epistemic_state' ? 'EPISTEMIC_STATE_INVALID' : 'ENUM_INVALID';
    refuse(code, `${field} must be one of ${allowed.join('|')}`);
  }
  return value;
}

function requireHex(value, pattern, field, code = 'IDENTITY_INVALID') {
  if (typeof value !== 'string' || !pattern.test(value)) refuse(code, `${field} must be exact lowercase hexadecimal`);
  return value;
}

function requireHexOrUnresolved(value, pattern, field, code) {
  if (value === 'UNRESOLVED') return value;
  return requireHex(value, pattern, field, code);
}

function requireStableId(value, prefix) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || !value.startsWith(`${prefix}_`)) {
    refuse('STABLE_ID_INVALID', `id must be a stable ${prefix}_ identifier`);
  }
  return value;
}

function requireRepoPath(value, field) {
  if (!isText(value) || value.includes('\\') || path.posix.isAbsolute(value) || value.split('/').includes('..') || value.startsWith('./') || path.posix.normalize(value) !== value) {
    refuse('PATH_NOT_REPOSITORY_RELATIVE', `${field} must be a normalized repository-relative POSIX path`);
  }
  return value;
}

function requireObservedAt(value) {
  if (!isText(value) || new Date(value).toISOString() !== value) refuse('OBSERVED_TIME_INVALID', 'observed_at must be a canonical ISO-8601 UTC timestamp');
  return value;
}

function requireOwner(value) {
  if (value !== 'UNKNOWN' && (typeof value !== 'string' || !OWNER_PATTERN.test(value))) {
    refuse('OWNER_INVALID', 'owner must be a canonical owner identifier or UNKNOWN');
  }
  return value;
}

function canonicalizeEvidence(value) {
  if (!Array.isArray(value) || value.length === 0) refuse('EVIDENCE_REQUIRED', 'evidence_refs must be a non-empty array');
  const seen = new Set();
  const evidence = value.map((entry) => {
    requireObject(entry, 'evidence_ref');
    requireExactFields(entry, ['ref', 'digest'], 'evidence_ref');
    if (!isText(entry.ref)) refuse('EVIDENCE_REF_REQUIRED', 'every evidence reference needs a non-empty ref');
    requireHex(entry.digest, HEX64, 'evidence_ref.digest', 'EVIDENCE_DIGEST_REQUIRED');
    const key = `${entry.ref}\u0000${entry.digest}`;
    if (seen.has(key)) refuse('DUPLICATE_EVIDENCE_REF', `duplicate evidence reference ${entry.ref}`);
    seen.add(key);
    return { ref: entry.ref, digest: entry.digest };
  });
  return evidence.sort((a, b) => a.ref.localeCompare(b.ref) || a.digest.localeCompare(b.digest));
}

function canonicalizeCommon(value, prefix, type, extraFields) {
  requireObject(value, type);
  const commonFields = [
    'schema_version', 'id', 'source_kind', 'source_identity', 'source_digest', 'source_path',
    'observed_at', 'epistemic_state', 'owner', 'evidence_refs', 'authority_effect',
  ];
  requireExactFields(value, [...commonFields, ...extraFields], type);
  if (value.schema_version !== RECONSTRUCTION_SCHEMA_VERSION) refuse('SCHEMA_VERSION_INVALID', `${type} must use ${RECONSTRUCTION_SCHEMA_VERSION}`);
  const authorityEffect = value.authority_effect;
  if (authorityEffect !== 'NONE') refuse('AUTHORITY_EFFECT_FORBIDDEN', `${type} is inert and authority_effect must be NONE`);
  return {
    schema_version: RECONSTRUCTION_SCHEMA_VERSION,
    id: requireStableId(value.id, prefix),
    source_kind: requireEnum(value.source_kind, SOURCE_KINDS, 'source_kind'),
    source_identity: requireHex(value.source_identity, HEX40_OR_64, 'source_identity'),
    source_digest: requireHex(value.source_digest, HEX64, 'source_digest', 'SOURCE_DIGEST_REQUIRED'),
    source_path: requireRepoPath(value.source_path, 'source_path'),
    observed_at: requireObservedAt(value.observed_at),
    epistemic_state: requireEnum(value.epistemic_state, EPISTEMIC_STATES, 'epistemic_state'),
    owner: requireOwner(value.owner),
    evidence_refs: canonicalizeEvidence(value.evidence_refs),
    authority_effect: 'NONE',
  };
}

export function canonicalizeNeedItem(value) {
  const common = canonicalizeCommon(value, 'need', 'NeedItem', ['need_state', 'need_kind', 'next_gate', 'gate_kind', 'decision_eligible']);
  if (!isText(value.need_kind)) refuse('NEED_KIND_REQUIRED', 'need_kind is required');
  if (!isText(value.next_gate)) refuse('NEXT_GATE_REQUIRED', 'next_gate is required');
  const needState = requireEnum(value.need_state, NEED_STATES, 'need_state');
  if (typeof value.decision_eligible !== 'boolean' || value.decision_eligible !== (needState === 'SATISFIED')) {
    refuse('NEED_DECISION_ELIGIBILITY_INVALID', 'decision_eligible is true only for SATISFIED NeedItems and false for every unresolved state');
  }
  return {
    ...common,
    need_state: needState,
    need_kind: value.need_kind,
    next_gate: value.next_gate,
    gate_kind: requireEnum(value.gate_kind, GATE_KINDS, 'gate_kind'),
    decision_eligible: value.decision_eligible,
  };
}

export function canonicalizePrConsumption(value) {
  const common = canonicalizeCommon(value, 'prc', 'PrConsumption', [
    'pr_number', 'pr_head_sha', 'pr_base_sha', 'pr_head_tree', 'changed_path',
    'head_blob_sha', 'content_digest', 'disposition', 'consuming_commit', 'consuming_path',
  ]);
  if (!Number.isSafeInteger(value.pr_number) || value.pr_number < 1) refuse('PR_NUMBER_INVALID', 'pr_number must be a positive safe integer');
  const disposition = requireEnum(value.disposition, PR_CONSUMPTION_DISPOSITIONS, 'disposition');
  const hasConsumingCommit = value.consuming_commit !== undefined;
  const hasConsumingPath = value.consuming_path !== undefined;
  if (hasConsumingCommit !== hasConsumingPath || (disposition === 'CONSUMED_EXACT') !== hasConsumingCommit) {
    refuse('CONSUMPTION_PAIR_REQUIRED', 'CONSUMED_EXACT requires both consuming_commit and consuming_path; no other disposition may imply consumption');
  }
  const headBlobSha = requireHexOrUnresolved(value.head_blob_sha, HEX40, 'head_blob_sha', 'HEAD_BLOB_SHA_INVALID');
  const contentDigest = requireHexOrUnresolved(value.content_digest, HEX64, 'content_digest', 'CONTENT_DIGEST_REQUIRED');
  const hasUnresolvedObject = headBlobSha === 'UNRESOLVED' || contentDigest === 'UNRESOLVED';
  if ((disposition === 'UNRESOLVED_OBJECT') !== hasUnresolvedObject) {
    refuse('UNRESOLVED_OBJECT_REQUIRED', 'UNRESOLVED_OBJECT is required exactly when the head blob or content digest is unresolved');
  }
  return {
    ...common,
    pr_number: value.pr_number,
    pr_head_sha: requireHex(value.pr_head_sha, HEX40, 'pr_head_sha'),
    pr_base_sha: requireHex(value.pr_base_sha, HEX40, 'pr_base_sha'),
    pr_head_tree: requireHex(value.pr_head_tree, HEX40, 'pr_head_tree'),
    changed_path: requireRepoPath(value.changed_path, 'changed_path'),
    head_blob_sha: headBlobSha,
    content_digest: contentDigest,
    disposition,
    ...(hasConsumingCommit ? {
      consuming_commit: requireHex(value.consuming_commit, HEX40, 'consuming_commit'),
      consuming_path: requireRepoPath(value.consuming_path, 'consuming_path'),
    } : {}),
  };
}

export function canonicalizeSourceHistoryNode(value) {
  const common = canonicalizeCommon(value, 'shn', 'SourceHistoryNode', ['node_kind', 'content_digest', 'descendant_disposition']);
  return {
    ...common,
    node_kind: requireEnum(value.node_kind, SOURCE_HISTORY_NODE_KINDS, 'node_kind'),
    content_digest: requireHex(value.content_digest, HEX64, 'content_digest', 'CONTENT_DIGEST_REQUIRED'),
    descendant_disposition: requireEnum(value.descendant_disposition, DESCENDANT_DISPOSITIONS, 'descendant_disposition'),
  };
}

export function canonicalizeSourceHistoryEdge(value) {
  const common = canonicalizeCommon(value, 'she', 'SourceHistoryEdge', ['from_id', 'to_id', 'edge_kind']);
  if (typeof value.from_id !== 'string' || !ID_PATTERN.test(value.from_id)) refuse('EDGE_ENDPOINT_INVALID', 'from_id must be a stable contract id');
  if (typeof value.to_id !== 'string' || !ID_PATTERN.test(value.to_id)) refuse('EDGE_ENDPOINT_INVALID', 'to_id must be a stable contract id');
  if (value.from_id === value.to_id) refuse('EDGE_ENDPOINT_INVALID', 'an edge cannot point to itself');
  return {
    ...common,
    from_id: value.from_id,
    to_id: value.to_id,
    edge_kind: requireEnum(value.edge_kind, SOURCE_HISTORY_EDGE_KINDS, 'edge_kind'),
  };
}

function canonicalizeArtifactDigests(value) {
  if (!Array.isArray(value) || value.length === 0) refuse('ARTIFACT_DIGEST_REQUIRED', 'artifact_digests must be a non-empty array');
  const paths = new Set();
  const rows = value.map((entry) => {
    requireObject(entry, 'artifact_digest');
    requireExactFields(entry, ['path', 'digest'], 'artifact_digest');
    const artifactPath = requireRepoPath(entry.path, 'artifact_digest.path');
    if (paths.has(artifactPath)) refuse('DUPLICATE_ARTIFACT_PATH', `duplicate artifact path ${artifactPath}`);
    paths.add(artifactPath);
    return { path: artifactPath, digest: requireHex(entry.digest, HEX64, 'artifact_digest.digest', 'ARTIFACT_DIGEST_REQUIRED') };
  });
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function canonicalizeZenithReconstructionReceipt(value) {
  const common = canonicalizeCommon(value, 'zrr', 'ZenithReconstructionReceipt', ['candidate_commit', 'candidate_tree', 'input_digest', 'artifact_digests']);
  return {
    ...common,
    candidate_commit: requireHex(value.candidate_commit, HEX40, 'candidate_commit'),
    candidate_tree: requireHex(value.candidate_tree, HEX40, 'candidate_tree'),
    input_digest: requireHex(value.input_digest, HEX64, 'input_digest', 'INPUT_DIGEST_REQUIRED'),
    artifact_digests: canonicalizeArtifactDigests(value.artifact_digests),
  };
}

function canonicalizeList(value, name, canonicalize) {
  if (!Array.isArray(value)) refuse('LIST_REQUIRED', `${name} must be an array`);
  return value.map(canonicalize).sort((a, b) => a.id.localeCompare(b.id));
}

export function canonicalizeReconstructionContracts(value) {
  requireObject(value, 'reconstruction_contracts');
  requireExactFields(value, ['need_items', 'pr_consumptions', 'source_history_nodes', 'source_history_edges', 'receipt'], 'reconstruction_contracts');
  const result = {
    schema_version: RECONSTRUCTION_SCHEMA_VERSION,
    need_items: canonicalizeList(value.need_items, 'need_items', canonicalizeNeedItem),
    pr_consumptions: canonicalizeList(value.pr_consumptions, 'pr_consumptions', canonicalizePrConsumption),
    source_history_nodes: canonicalizeList(value.source_history_nodes, 'source_history_nodes', canonicalizeSourceHistoryNode),
    source_history_edges: canonicalizeList(value.source_history_edges, 'source_history_edges', canonicalizeSourceHistoryEdge),
    receipt: canonicalizeZenithReconstructionReceipt(value.receipt),
  };
  const ids = [
    ...result.need_items, ...result.pr_consumptions, ...result.source_history_nodes,
    ...result.source_history_edges, result.receipt,
  ].map((entry) => entry.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) refuse('DUPLICATE_ID', 'all reconstruction contract ids must be globally unique');
  return clone(result);
}
