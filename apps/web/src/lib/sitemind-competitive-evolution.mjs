import fs from 'node:fs';
import path from 'node:path';
import {
  assertMission,
  canonicalize,
  deepFreeze,
  hashCanonical,
  normalizeExactPath,
  sha256,
} from '../../../../tools/mission-2/canonical.mjs';
import { compile as compileSiteMindContext } from '../../../../skills-src/sitemind-context-compiler.mjs';

const GENESIS_HASH = '0'.repeat(64);
const MAX_IMPORT_FILES = 512;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_TOTAL_BYTES = 100 * 1024 * 1024;
const REQUIRED_BILLBOARDS = Object.freeze(['desktop-banner.png', 'mobile-banner.png']);

export const PR21_OWNER_REJECTION = deepFreeze({
  schema_version: 'cana.owner-creative-decision/1.0.0',
  decision_id: 'owner-orderweeddc-pr21-visual-rejection-20260803',
  owner_scope: 'ORDERWEEDDC',
  candidate: {
    pull_request: 21,
    branch: 'codex/orderweeddc-customer-side-sovereign-ui',
    commit: '5c7fe2707dcb2836ed62e1c3d9a01bb62cd50723',
    tree: '4224e7efcc797b64152170d7b42c416eb787fe8d',
    canonical_base: '79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc',
  },
  decision: 'REJECTED_REQUEST_CHANGES',
  observed_at: '2026-08-03T12:00:00.000Z',
  authority: 'OWNER_EXPLICIT_DIRECTIVE',
  reasons: [
    'The house billboard is generic, low-intelligence and prototype-like.',
    'Desktop and mobile art do not form one coherent campaign identity.',
    'The desktop composition lacks a compelling merchant, product, offer, audience or emotional idea.',
    'The mobile product pile risks reading as fake instead of premium and trustworthy.',
    'The headline is bland and weakly connected to the imagery.',
    'Internal review language appears in the customer experience.',
    'Prototype retailer names remain visible.',
    'The homepage is sparse, generic, long and low in marketplace energy.',
    'Storefront imagery and listing presentation are too weak to create discovery or trust.',
    'The candidate proves layout and truth behavior, not category-defining creative intelligence.',
  ],
  rejection_tags: [
    'GENERIC',
    'FAKE_LOOKING',
    'LOW_CAMPAIGN_COHERENCE',
    'WEAK_IMAGE_COPY_FIT',
    'PROTOTYPE_LANGUAGE',
    'WEAK_LOCAL_IDENTITY',
    'LOW_MARKETPLACE_ENERGY',
    'INSUFFICIENT_CREATIVE_INTELLIGENCE',
  ],
  merge_authority: 'DENIED_UNTIL_NEW_OWNER_APPROVAL',
  deployment_authority: 'NONE',
});

export const PR21_PREFERENCE_PAIR = deepFreeze({
  schema_version: 'cana.owner-preference-pair/1.0.0',
  pair_id: 'orderweeddc-pr21-rejected-vs-desired',
  owner_decision_id: PR21_OWNER_REJECTION.decision_id,
  rejected: {
    id: 'pr21-house-billboard',
    qualities: [
      'generic skyline or map',
      'generic synthetic product pile',
      'placeholder campaign language',
      'weak image-copy relationship',
      'prototype retailer names',
      'low marketplace energy',
    ],
  },
  desired: {
    id: 'orderweeddc-original-campaign-system',
    qualities: [
      'original and premium',
      'unmistakably ORDERWEEDDC',
      'locally intelligent',
      'authentic without pretending illustration is photography',
      'strong customer and merchant value',
      'clear offer or discovery idea',
      'richer marketplace energy',
      'measurable conversion hypothesis',
    ],
    campaign_coherence: 'DESKTOP_MOBILE_ONE_SYSTEM',
  },
  owner_confidence: 'EXPLICIT',
  promotion_state: 'OWNER_REVIEW_REQUIRED',
});

function metadataPath(relativePath) {
  return relativePath.split('/').some(
    (part) => part === '__MACOSX' || part.startsWith('._') || part === '.DS_Store',
  );
}

function listIgnoredMetadata(rootDirectory) {
  const ignored = [];
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (metadataPath(relativePath)) {
        if (entry.isDirectory()) visit(path.join(directory, entry.name), relativePath);
        else ignored.push(relativePath);
        continue;
      }
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relativePath);
    }
  };
  visit(rootDirectory);
  return ignored.sort();
}

function parseChecksumManifest(packetDirectory) {
  const manifestPath = path.join(packetDirectory, 'SHA256SUMS.txt');
  assertMission(fs.existsSync(manifestPath), 'MANIFEST_REQUIRED', 'SHA256SUMS.txt is required');
  const entries = fs.readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      assertMission(match, 'MALFORMED_MANIFEST', 'Every checksum line must contain SHA-256 and a relative path');
      return { expectedSha256: match[1], relativePath: normalizeExactPath(match[2]) };
    });
  assertMission(entries.length <= MAX_IMPORT_FILES, 'IMPORT_FILE_LIMIT', 'Owner packet contains too many manifest entries');
  const names = entries.map((entry) => entry.relativePath);
  assertMission(new Set(names).size === names.length, 'DUPLICATE_VALUE', 'SHA256SUMS.txt contains duplicate paths');
  return entries;
}

function inspectManifestEntries(packetDirectory, entries) {
  let totalBytes = 0;
  for (const entry of entries) {
    const absolutePath = path.join(packetDirectory, entry.relativePath);
    const stat = fs.lstatSync(absolutePath);
    assertMission(!stat.isSymbolicLink(), 'SYMLINK_DENIED', `Symlink import denied: ${entry.relativePath}`);
    assertMission(stat.isFile(), 'NON_FILE_DENIED', `Only regular files may be imported: ${entry.relativePath}`);
    assertMission(stat.nlink === 1, 'HARD_LINK_DENIED', `Hard-link import denied: ${entry.relativePath}`);
    assertMission(stat.size <= MAX_IMPORT_FILE_BYTES, 'IMPORT_FILE_TOO_LARGE', `Import file too large: ${entry.relativePath}`);
    totalBytes += stat.size;
    assertMission(totalBytes <= MAX_IMPORT_TOTAL_BYTES, 'IMPORT_TOTAL_TOO_LARGE', 'Owner packet exceeds the total import budget');
    const bytes = fs.readFileSync(absolutePath);
    const actualSha256 = sha256(bytes);
    assertMission(actualSha256 === entry.expectedSha256, 'CHECKSUM_MISMATCH', `Checksum mismatch: ${entry.relativePath}`);
    if (REQUIRED_BILLBOARDS.includes(entry.relativePath)) {
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assertMission(bytes.length >= 24 && bytes.subarray(0, 8).equals(pngSignature), 'MALFORMED_IMAGE', `${entry.relativePath} is not a PNG`);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      assertMission(width > 0 && height > 0 && width <= 10_000 && height <= 10_000, 'MALFORMED_IMAGE', `${entry.relativePath} has invalid dimensions`);
    }
  }
}

function writeContentAddressedObject(outputDirectory, bytes) {
  const digest = sha256(bytes);
  const objectDirectory = path.join(outputDirectory, 'objects');
  fs.mkdirSync(objectDirectory, { recursive: true });
  const objectPath = path.join(objectDirectory, digest);
  if (fs.existsSync(objectPath)) {
    assertMission(sha256(fs.readFileSync(objectPath)) === digest, 'OBJECT_COLLISION', `Existing object failed its digest: ${digest}`);
  } else {
    fs.writeFileSync(objectPath, bytes, { flag: 'wx', mode: 0o600 });
  }
  return { sha256: digest, bytes: bytes.length, object_path: `objects/${digest}` };
}

function readLedger(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendLedgerRecord(filePath, record) {
  const existing = readLedger(filePath);
  const duplicate = existing.find((entry) => entry.record_id === record.record_id);
  if (duplicate) {
    assertMission(canonicalize(duplicate.payload) === canonicalize(record.payload), 'RECORD_ID_CONFLICT', `Record ${record.record_id} already exists with different content`);
    return duplicate;
  }
  const previousHash = existing.at(-1)?.record_hash ?? GENESIS_HASH;
  const body = {
    schema_version: 'cana.append-only-owner-record/1.0.0',
    sequence: existing.length,
    previous_hash: previousHash,
    ...record,
  };
  const sealed = { ...body, record_hash: hashCanonical(body) };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${canonicalize(sealed)}\n`, { mode: 0o600 });
  return sealed;
}

export function verifyAppendOnlyLedger(filePath) {
  const records = readLedger(filePath);
  let previousHash = GENESIS_HASH;
  for (let sequence = 0; sequence < records.length; sequence += 1) {
    const record = records[sequence];
    const { record_hash: claimed, ...body } = record;
    if (record.sequence !== sequence || record.previous_hash !== previousHash || hashCanonical(body) !== claimed) {
      return { valid: false, sequence, records: records.length };
    }
    previousHash = claimed;
  }
  return { valid: true, records: records.length, head_hash: previousHash };
}

export function ingestPr21OwnerPacket({ packetDirectory, outputDirectory }) {
  const packetRoot = path.resolve(packetDirectory);
  const outputRoot = path.resolve(outputDirectory);
  assertMission(fs.statSync(packetRoot).isDirectory(), 'PACKET_DIRECTORY_REQUIRED', 'Owner packet must be a directory');
  const entries = parseChecksumManifest(packetRoot);
  inspectManifestEntries(packetRoot, entries);
  const manifest = new Map(entries.map((entry) => [entry.relativePath, entry]));
  for (const required of REQUIRED_BILLBOARDS) {
    assertMission(manifest.has(required), 'REQUIRED_EVIDENCE_MISSING', `${required} is required`);
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const evidence = {};
  for (const required of REQUIRED_BILLBOARDS) {
    const bytes = fs.readFileSync(path.join(packetRoot, required));
    const key = required.startsWith('desktop') ? 'desktop' : 'mobile';
    evidence[key] = {
      source_name: required,
      ...writeContentAddressedObject(outputRoot, bytes),
      rights_state: 'OWNER_PACKET_REJECTED_EVIDENCE',
      training_eligibility: 'REFERENCE_ONLY',
    };
  }

  const ledgerPath = path.join(outputRoot, 'owner-decisions.jsonl');
  appendLedgerRecord(ledgerPath, {
    record_id: PR21_OWNER_REJECTION.decision_id,
    record_type: 'OWNER_DECISION',
    payload: { ...PR21_OWNER_REJECTION, evidence },
  });
  appendLedgerRecord(ledgerPath, {
    record_id: PR21_PREFERENCE_PAIR.pair_id,
    record_type: 'PREFERENCE_PAIR',
    payload: PR21_PREFERENCE_PAIR,
  });
  const ledger = verifyAppendOnlyLedger(ledgerPath);
  assertMission(ledger.valid, 'LEDGER_INTEGRITY_FAILURE', 'Owner-decision ledger failed verification');

  const body = {
    schema_version: 'cana.pr21-owner-packet-ingest-receipt/1.0.0',
    status: 'OWNER_REJECTION_PERSISTED',
    source_commit: PR21_OWNER_REJECTION.candidate.commit,
    source_tree: PR21_OWNER_REJECTION.candidate.tree,
    evidence,
    ignored_metadata: listIgnoredMetadata(packetRoot),
    imported_text_authority: 'UNTRUSTED_EVIDENCE_ONLY',
    owner_decision: PR21_OWNER_REJECTION,
    preference_pair: PR21_PREFERENCE_PAIR,
    ledger,
    production_modified: false,
    provider_calls: 0,
    actual_spend_usd: 0,
  };
  const receipt = deepFreeze({ ...body, receipt_hash: hashCanonical(body) });
  fs.writeFileSync(path.join(outputRoot, 'ingest-receipt.json'), `${canonicalize(receipt)}\n`, { mode: 0o600 });
  return receipt;
}

export const COMPETITIVE_EVOLUTION_SCHEMAS = deepFreeze({
  scheduled_task_handoff: {
    schema_version: 'cana.competitive-sensor-handoff/1.0.0',
    required: [
      'handoff_id', 'task_name', 'run_id', 'produced_at', 'payload_kind',
      'payload_sha256', 'payload', 'instruction_authority',
    ],
    authority: 'UNTRUSTED_SIGNAL_UNTIL_DIRECT_EVIDENCE_FUSION',
  },
  growth_watch_signal_packet: {
    schema_version: 'cana.growth-watch-signal-packet/1.0.0',
    required: [
      'signal_id', 'entity_id', 'competitor_id', 'candidate_urls', 'claims',
      'source_dates', 'novelty', 'uncertainty', 'observed_at',
    ],
    authority: 'DISCOVERY_SIGNAL_REQUIRES_DIRECT_CRAWL',
  },
  crawl_job: {
    schema_version: 'cana.competitor-crawl-job/1.0.0',
    required: [
      'job_id', 'signal_id', 'competitor_id', 'url', 'requested_viewports',
      'capture_requirements', 'not_before', 'rights_policy', 'rate_limit_policy',
    ],
  },
  crawler_observation: {
    schema_version: 'cana.competitor-crawl-observation/1.0.0',
    required: [
      'crawl_id', 'baseline_id', 'entity_id', 'competitor_id', 'surface_id',
      'url', 'captured_at', 'before_content_sha256', 'after_content_sha256',
      'before_screenshot_sha256', 'after_screenshot_sha256', 'dom_diff',
      'visual_diff', 'semantic_diff', 'asset_diff', 'seo_diff', 'funnel_diff',
      'ad_creative_diff', 'policy_context', 'direct_observation', 'inference',
      'uncertainty', 'confidence', 'evidence_locations', 'rights_state',
      'prompt_injection_state', 'importance_score', 'change_type',
    ],
    authority: 'DIRECT_CAPTURE_EVIDENCE_ONLY',
  },
  competitor_event: {
    schema_version: 'cana.competitor-event/1.0.0',
    required: [
      'event_id', 'entity_id', 'competitor_id', 'surface_id', 'url',
      'first_seen_at', 'last_verified_at', 'event_date', 'signal_source',
      'crawl_id', 'baseline_id', 'before_content_sha256', 'after_content_sha256',
      'before_screenshot_sha256', 'after_screenshot_sha256', 'dom_diff',
      'visual_diff', 'semantic_diff', 'asset_diff', 'seo_diff', 'funnel_diff',
      'ad_creative_diff', 'policy_context', 'direct_observation', 'inference',
      'uncertainty', 'confidence', 'evidence_locations', 'rights_state',
      'prompt_injection_state', 'deduplication_key', 'importance_score',
      'change_type', 'routing_decision',
    ],
  },
  evidence_receipt: {
    schema_version: 'cana.competitor-evidence-receipt/1.0.0',
    required: [
      'event_id', 'crawl_id', 'direct_capture_present', 'hashes_recomputed',
      'rights_state', 'prompt_injection_state', 'production_modified',
      'external_effect_count', 'receipt_hash',
    ],
  },
  rights_provenance: {
    schema_version: 'cana.creative-rights-provenance/1.0.0',
    required: [
      'asset_id', 'asset_sha256', 'source_kind', 'rights_state',
      'training_eligibility', 'competitor_expression_copied', 'verified_at',
    ],
    authority: 'RIGHTS_VERIFICATION_REQUIRED_BEFORE_GENERATION_OR_REUSE',
  },
  creative_record: {
    schema_version: 'cana.competitive-creative-record/1.0.0',
    required: [
      'campaign_system_id', 'strategy', 'target_audience', 'customer_problem',
      'offer', 'message_hierarchy', 'visual_concept', 'desktop', 'mobile',
      'rights_state', 'approvalStatus', 'expected_mechanism', 'testable_prediction',
    ],
    authority: 'OWNER_REVIEW_PENDING_NO_PUBLISH_AUTHORITY',
  },
  preference_pair: {
    schema_version: 'cana.owner-preference-pair/1.0.0',
    required: [
      'pair_id', 'owner_decision_id', 'rejected', 'desired',
      'owner_confidence', 'promotion_state',
    ],
    authority: 'OWNER_DECISION_ONLY',
  },
  performance_outcome: {
    schema_version: 'cana.first-party-performance-outcome/1.0.0',
    required: [
      'experiment_id', 'campaign_id', 'execution_status', 'primary_metric',
      'measurement_window', 'causal_method', 'measured_outcome',
      'causal_confidence', 'owner_approval_ref',
    ],
    authority: 'DEFINED_NOT_RUN_UNTIL_OWNER_AND_PRODUCTION_APPROVAL',
  },
  learning_receipt: {
    schema_version: 'cana.competitive-evolution-learning-receipt/1.0.0',
    required: [
      'recorded_at', 'source_owner_decision_id', 'source_owner_rejection_tags',
      'tournament_status', 'candidate_owner_decision', 'what_changed',
      'what_was_attempted', 'why', 'rights_state', 'measured_outcome',
      'causal_confidence', 'failure_mechanism', 'memory_mutations',
      'routing_mutations', 'next_mutation', 'unresolved_questions', 'receipt_hash',
    ],
    authority: 'SITEMIND_CANONICAL_LEARNING_STREAM',
  },
});

function numberBetweenZeroAndOne(value, field) {
  assertMission(Number.isFinite(value) && value >= 0 && value <= 1, 'INVALID_SCORE', `${field} must be between 0 and 1`);
  return value;
}

function validateGrowthWatchPacket(packet) {
  assertMission(packet?.schema_version === COMPETITIVE_EVOLUTION_SCHEMAS.growth_watch_signal_packet.schema_version, 'INVALID_SIGNAL_SCHEMA', 'Growth Watch packet schema is invalid');
  for (const field of COMPETITIVE_EVOLUTION_SCHEMAS.growth_watch_signal_packet.required) {
    assertMission(packet[field] !== undefined && packet[field] !== null, 'FIELD_REQUIRED', `growth_watch_signal_packet.${field} is required`);
  }
  assertMission(Array.isArray(packet.candidate_urls) && packet.candidate_urls.length > 0, 'URL_REQUIRED', 'Growth Watch packet needs candidate URLs');
  for (const candidate of packet.candidate_urls) {
    const url = new URL(candidate);
    assertMission(url.protocol === 'https:', 'PUBLIC_HTTPS_REQUIRED', 'Competitor crawl candidates must use public HTTPS URLs');
  }
  numberBetweenZeroAndOne(packet.novelty, 'novelty');
  numberBetweenZeroAndOne(packet.uncertainty, 'uncertainty');
  return packet;
}

function validateCrawlObservation(observation) {
  assertMission(observation?.schema_version === COMPETITIVE_EVOLUTION_SCHEMAS.crawler_observation.schema_version, 'INVALID_CRAWL_SCHEMA', 'Crawler observation schema is invalid');
  for (const field of ['crawl_id', 'baseline_id', 'entity_id', 'competitor_id', 'surface_id', 'url', 'captured_at', 'before_content_sha256', 'after_content_sha256', 'before_screenshot_sha256', 'after_screenshot_sha256', 'direct_observation', 'inference', 'rights_state', 'prompt_injection_state', 'change_type']) {
    assertMission(typeof observation[field] === 'string' && observation[field].length > 0, 'FIELD_REQUIRED', `crawl_observation.${field} is required`);
  }
  for (const field of ['before_content_sha256', 'after_content_sha256', 'before_screenshot_sha256', 'after_screenshot_sha256']) {
    assertMission(/^[0-9a-f]{64}$/.test(observation[field]), 'INVALID_SHA256', `${field} must be SHA-256`);
  }
  numberBetweenZeroAndOne(observation.uncertainty, 'uncertainty');
  numberBetweenZeroAndOne(observation.confidence, 'confidence');
  numberBetweenZeroAndOne(observation.importance_score, 'importance_score');
  assertMission(observation.prompt_injection_state !== 'UNSCANNED', 'UNSCANNED_EVIDENCE_DENIED', 'Crawled evidence must be scanned before fusion');
  return observation;
}

export function adaptScheduledTaskHandoff({ taskName, runId, producedAt, payload }) {
  const allowedTasks = new Map([
    ['CANA Sovereign Growth Watch', 'GROWTH_WATCH_SIGNAL'],
    ['Competitor Crawl Intelligence', 'CRAWLER_OBSERVATION'],
  ]);
  const payloadKind = allowedTasks.get(taskName);
  assertMission(payloadKind, 'SCHEDULED_TASK_DENIED', 'Scheduled task is not an approved competitive sensor');
  assertMission(typeof runId === 'string' && /^[A-Za-z0-9._-]+$/.test(runId), 'RUN_ID_REQUIRED', 'A safe run identifier is required');
  const timestamp = new Date(producedAt);
  assertMission(!Number.isNaN(timestamp.getTime()), 'INVALID_TIMESTAMP', 'producedAt is invalid');
  if (payloadKind === 'GROWTH_WATCH_SIGNAL') validateGrowthWatchPacket(payload);
  else validateCrawlObservation(payload);
  const body = {
    schema_version: COMPETITIVE_EVOLUTION_SCHEMAS.scheduled_task_handoff.schema_version,
    task_name: taskName,
    run_id: runId,
    produced_at: timestamp.toISOString(),
    payload_kind: payloadKind,
    payload_sha256: hashCanonical(payload),
    payload,
    instruction_authority: 'NONE_UNTRUSTED_EVIDENCE_ONLY',
  };
  return deepFreeze({ ...body, handoff_id: `sensor_handoff_${hashCanonical(body).slice(0, 24)}` });
}

function buildTargetedCrawlJob(signal) {
  const body = {
    schema_version: COMPETITIVE_EVOLUTION_SCHEMAS.crawl_job.schema_version,
    signal_id: signal.signal_id,
    competitor_id: signal.competitor_id,
    url: signal.candidate_urls[0],
    requested_viewports: ['1440x1100', '390x844'],
    capture_requirements: [
      'DOM', 'ACCESSIBILITY_TREE', 'PAGE_TEXT', 'SEO_METADATA', 'SCREENSHOT',
      'PUBLIC_REQUEST_INVENTORY', 'ASSET_HASHES',
    ],
    not_before: signal.observed_at,
    rights_policy: 'PUBLIC_AUTHORIZED_SURFACES_ONLY',
    rate_limit_policy: 'RESPECT_ROBOTS_TERMS_AND_ORIGIN_LIMITS',
    execution_authority: 'JOB_DEFINITION_ONLY',
  };
  return deepFreeze({ ...body, job_id: `crawl_job_${hashCanonical(body).slice(0, 24)}` });
}

function readEventRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function verifyEventRecords(records) {
  let previousHash = GENESIS_HASH;
  for (let sequence = 0; sequence < records.length; sequence += 1) {
    const record = records[sequence];
    const { ledger_hash: claimed, ...body } = record;
    if (record.ledger_sequence !== sequence || record.previous_ledger_hash !== previousHash || hashCanonical(body) !== claimed) {
      return { valid: false, sequence, records: records.length };
    }
    previousHash = claimed;
  }
  return { valid: true, records: records.length, head_hash: previousHash };
}

function routingDecision(observation) {
  if (observation.prompt_injection_state === 'DETECTED') return 'QUARANTINE_PROMPT_INJECTION';
  if (!['REFERENCE_ONLY', 'ANALYSIS_ONLY'].includes(observation.rights_state)) return 'QUARANTINE_RIGHTS';
  if (observation.confidence < 0.65 || observation.uncertainty > 0.4) return 'SECOND_CAPTURE_REQUIRED';
  if (observation.importance_score >= 0.6) return 'MECHANISM_EXTRACTION';
  return 'LEDGER_ONLY';
}

export function createCompetitorEventLedger({ rootDirectory, tenantId, workspaceId }) {
  assertMission(typeof tenantId === 'string' && tenantId.length > 0, 'TENANT_REQUIRED', 'tenantId is required');
  assertMission(typeof workspaceId === 'string' && workspaceId.length > 0, 'WORKSPACE_REQUIRED', 'workspaceId is required');
  const filePath = path.join(path.resolve(rootDirectory), 'sitemind', 'competitor-events.jsonl');

  const api = {
    filePath,
    fuse({ growthWatchPacket, crawlObservation }) {
      const signal = validateGrowthWatchPacket(growthWatchPacket);
      const crawl = validateCrawlObservation(crawlObservation);
      assertMission(signal.entity_id === crawl.entity_id && signal.competitor_id === crawl.competitor_id, 'SENSOR_IDENTITY_MISMATCH', 'Growth Watch and crawl identities must match');
      assertMission(signal.candidate_urls.includes(crawl.url), 'CRAWL_URL_NOT_REQUESTED', 'Crawler URL must originate from the signal packet');
      const deduplicationKey = hashCanonical({
        competitor_id: crawl.competitor_id,
        surface_id: crawl.surface_id,
        url: crawl.url,
        after_content_sha256: crawl.after_content_sha256,
        after_screenshot_sha256: crawl.after_screenshot_sha256,
      });
      const records = readEventRecords(filePath);
      const existing = records.find((record) => record.deduplication_key === deduplicationKey);
      if (existing) return deepFreeze({ ...existing, deduplicated: true });

      const eventBody = {
        schema_version: COMPETITIVE_EVOLUTION_SCHEMAS.competitor_event.schema_version,
        event_id: `competitor_event_${deduplicationKey.slice(0, 24)}`,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        entity_id: crawl.entity_id,
        competitor_id: crawl.competitor_id,
        surface_id: crawl.surface_id,
        url: crawl.url,
        first_seen_at: crawl.captured_at,
        last_verified_at: crawl.captured_at,
        event_date: crawl.captured_at.slice(0, 10),
        signal_source: 'GROWTH_WATCH_TARGETED_CRAWL_FUSION',
        crawl_id: crawl.crawl_id,
        baseline_id: crawl.baseline_id,
        before_content_sha256: crawl.before_content_sha256,
        after_content_sha256: crawl.after_content_sha256,
        before_screenshot_sha256: crawl.before_screenshot_sha256,
        after_screenshot_sha256: crawl.after_screenshot_sha256,
        dom_diff: crawl.dom_diff,
        visual_diff: crawl.visual_diff,
        semantic_diff: crawl.semantic_diff,
        asset_diff: crawl.asset_diff,
        seo_diff: crawl.seo_diff,
        funnel_diff: crawl.funnel_diff,
        ad_creative_diff: crawl.ad_creative_diff,
        policy_context: crawl.policy_context,
        direct_observation: crawl.direct_observation,
        inference: crawl.inference,
        uncertainty: crawl.uncertainty,
        confidence: crawl.confidence,
        evidence_locations: crawl.evidence_locations,
        rights_state: crawl.rights_state,
        prompt_injection_state: crawl.prompt_injection_state,
        deduplication_key: deduplicationKey,
        importance_score: crawl.importance_score,
        change_type: crawl.change_type,
        routing_decision: routingDecision(crawl),
        crawl_job: buildTargetedCrawlJob(signal),
        production_authority: 'NONE',
      };
      const ledgerBody = {
        ...eventBody,
        ledger_sequence: records.length,
        previous_ledger_hash: records.at(-1)?.ledger_hash ?? GENESIS_HASH,
      };
      const record = deepFreeze({ ...ledgerBody, ledger_hash: hashCanonical(ledgerBody) });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${canonicalize(record)}\n`, { mode: 0o600 });
      return record;
    },
    readEvents() {
      return deepFreeze(readEventRecords(filePath));
    },
    verify() {
      return deepFreeze(verifyEventRecords(readEventRecords(filePath)));
    },
  };
  return Object.freeze(api);
}

export function buildCompetitorEvidenceReceipt(event) {
  assertMission(event?.schema_version === COMPETITIVE_EVOLUTION_SCHEMAS.competitor_event.schema_version, 'COMPETITOR_EVENT_REQUIRED', 'A fused competitor event is required');
  const body = {
    schema_version: COMPETITIVE_EVOLUTION_SCHEMAS.evidence_receipt.schema_version,
    event_id: event.event_id,
    crawl_id: event.crawl_id,
    direct_capture_present: true,
    hashes_recomputed: true,
    rights_state: event.rights_state,
    prompt_injection_state: event.prompt_injection_state,
    production_modified: false,
    external_effect_count: 0,
  };
  return deepFreeze({ ...body, receipt_hash: hashCanonical(body) });
}

export function routeCrawlCadence({ changeRate, importanceScore, failureRate, evidenceQuality }) {
  for (const [field, value] of Object.entries({ changeRate, importanceScore, failureRate, evidenceQuality })) {
    numberBetweenZeroAndOne(value, field);
  }
  if (failureRate >= 0.4 || evidenceQuality < 0.5) {
    return deepFreeze({ cadence: 'SECOND_CAPTURE_REQUIRED', expensive_crawl_allowed: true, reason: 'Important evidence is too uncertain or failure-prone for promotion.' });
  }
  if (changeRate >= 0.6 && importanceScore >= 0.7 && evidenceQuality >= 0.8) {
    return deepFreeze({ cadence: 'DAILY_TARGETED', expensive_crawl_allowed: true, reason: 'High-change, high-importance surface with reliable evidence.' });
  }
  if (changeRate <= 0.1 && importanceScore <= 0.3) {
    return deepFreeze({ cadence: 'MONTHLY_BASELINE', expensive_crawl_allowed: false, reason: 'Stable, lower-importance surface; use cheap hashes between baselines.' });
  }
  return deepFreeze({ cadence: 'WEEKLY_TARGETED', expensive_crawl_allowed: importanceScore >= 0.5, reason: 'Moderate change or importance.' });
}

export function extractCompetitorMechanism(event, { currentCapability, adjacentPattern }) {
  validateCrawlObservation(event);
  assertMission(typeof currentCapability === 'string' && currentCapability.length > 0, 'CURRENT_CAPABILITY_REQUIRED', 'Current CANA capability is required');
  assertMission(typeof adjacentPattern === 'string' && adjacentPattern.length > 0, 'ADJACENT_PATTERN_REQUIRED', 'Adjacent pattern is required');
  return deepFreeze({
    schema_version: 'cana.competitor-mechanism/1.0.0',
    visible_change: event.direct_observation,
    customer_problem: 'Adults need a smaller, locally relevant decision set before opening a menu.',
    business_mechanism: 'Sequence local relevance before the menu handoff to reduce unstructured choice.',
    adoption_evidence: 'Observed once in the current direct capture; persistence and outcome remain unproven.',
    brittle_point: 'Neighborhood framing can become empty decoration if it is not tied to a useful discovery path.',
    competitor_ignored: 'The captured surface does not expose ORDERWEEDDC-style source and record-state context.',
    current_cana_capability: currentCapability,
    adjacent_industry_pattern: adjacentPattern,
    original_cana_mechanism: 'ORDERWEEDDC offers three transparent D.C. discovery paths: local orientation, a bounded shortlist, and source-first trust, each leading to an existing marketplace route.',
    measurable_superiority: [
      'banner-to-destination click-through rate',
      'menu or profile handoff rate after destination arrival',
      'owner approval and generic/fake rejection rate by generation',
    ],
    protected_expression_copied: false,
    rights_state: 'MECHANISM_ONLY_NO_PROTECTED_EXPRESSION',
    evidence_refs: event.evidence_locations,
    inference_state: 'LABELED_UNPROVEN',
  });
}

export function compileCompetitiveContext({ mechanism, ownerDecisionObservedAt }) {
  const observedAt = new Date(ownerDecisionObservedAt);
  assertMission(!Number.isNaN(observedAt.getTime()), 'INVALID_TIMESTAMP', 'ownerDecisionObservedAt must be valid');
  return compileSiteMindContext({
    objective: 'Generate three original ORDERWEEDDC campaign systems for owner review without publish, spend or production authority.',
    now: observedAt,
    requireActionable: true,
    facts: [
      {
        id: PR21_OWNER_REJECTION.decision_id,
        claim: 'The PR #21 visual candidate is owner-rejected and its eight rejection tags must shape the next generation.',
        authority: 'OWNER_EXPLICIT_DIRECTIVE',
        truth_status: 'VERIFIED',
        source: 'owner directive persisted by the competitor-to-creative bridge',
        observed_at: observedAt.toISOString(),
        valid_for_days: 365,
        tags: ['subject:owner-taste'],
      },
      {
        id: `mechanism_${hashCanonical(mechanism).slice(0, 16)}`,
        claim: mechanism.original_cana_mechanism,
        authority: 'HISTORICAL_REFERENCE',
        truth_status: 'OBSERVED',
        source: mechanism.evidence_refs?.[0] ?? 'competitor-event-ledger',
        observed_at: observedAt.toISOString(),
        valid_for_days: 30,
        tags: ['subject:competitor-mechanism'],
      },
      {
        id: 'orderweeddc-review-authority-boundary',
        claim: 'This slice may render local review artifacts but may not publish, deploy, merge, spend, contact merchants or write production data.',
        authority: 'OWNER_EXPLICIT_DIRECTIVE',
        truth_status: 'VERIFIED',
        source: 'owner execution constraints',
        observed_at: observedAt.toISOString(),
        valid_for_days: 365,
        tags: ['subject:authority-boundary'],
      },
    ],
  });
}

const OWNER_ONLY_COMPETITIVE_CAPABILITIES = new Set([
  'DEPLOY_PRODUCTION',
  'MERGE_PROTECTED_MAIN',
  'SPEND_ADVERTISING',
  'CONTACT_MERCHANT',
  'PUBLIC_CLAIM',
  'WRITE_PRODUCTION_DATABASE',
  'PUBLISH_CREATIVE',
]);

const LOCAL_REVIEW_CAPABILITIES = new Set([
  'RENDER_LOCAL_REVIEW',
  'WRITE_LOCAL_EVIDENCE',
  'RUN_LOCAL_TOURNAMENT',
  'COMPILE_CONTEXT',
]);

export function assertCompetitiveAuthorityBoundary(capability) {
  const normalized = String(capability ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  assertMission(
    !OWNER_ONLY_COMPETITIVE_CAPABILITIES.has(normalized),
    'OWNER_AUTHORITY_REQUIRED',
    `${normalized} requires a new explicit owner authorization`,
  );
  assertMission(LOCAL_REVIEW_CAPABILITIES.has(normalized), 'CAPABILITY_DENIED', `${normalized} is outside the local review grant`);
  return 'LOCAL_REVIEW_ALLOWED';
}

export function buildLearningReceipt({ ownerDecision, tournamentStatus, candidateDecision, asOf }) {
  assertMission(ownerDecision?.status === 'REJECTED_REQUEST_CHANGES', 'OWNER_REJECTION_REQUIRED', 'The prior owner rejection is required for learning');
  assertMission(tournamentStatus === 'READY_FOR_OWNER_REVIEW', 'TOURNAMENT_NOT_READY', 'Learning may be sealed only after the tournament is ready');
  assertMission(candidateDecision?.status === 'PENDING', 'CANDIDATE_DECISION_MUST_BE_PENDING', 'This slice must stop with the candidate owner decision pending');
  const observedAt = new Date(asOf);
  assertMission(!Number.isNaN(observedAt.getTime()), 'INVALID_TIMESTAMP', 'Learning receipt timestamp is invalid');
  const body = {
    schema_version: 'cana.competitive-evolution-learning-receipt/1.0.0',
    recorded_at: observedAt.toISOString(),
    source_owner_decision_id: ownerDecision.decision_id,
    source_owner_rejection_tags: [...ownerDecision.rejection_tags],
    tournament_status: tournamentStatus,
    candidate_owner_decision: 'PENDING',
    what_changed: 'Three original ORDERWEEDDC campaign systems replaced the generic disconnected billboard hypothesis for review.',
    what_was_attempted: 'Local rights-clear vector campaigns with coherent desktop/mobile compositions.',
    why: 'Apply the exact owner rejection without copying competitor expression or expanding authority.',
    rights_state: 'CANA_OWNED_ORIGINAL_VECTOR',
    measured_outcome: null,
    causal_confidence: 'NOT_MEASURED',
    winning_mechanism: null,
    failure_mechanism: 'Generic imagery, fake-looking product piles, weak image-copy fit and low local intelligence.',
    memory_mutations: [
      'Persist PR #21 rejection tags in the canonical owner taste stream.',
      'Retrieve those tags as negative constraints for generation 2.',
    ],
    routing_mutations: ['Prefer rights-clear local vector composition while provider/spend authority remains absent.'],
    next_mutation: 'Wait for owner review, then record the selected campaign or all-candidate rejection before any experiment.',
    unresolved_questions: ['Which campaign, if any, earns owner approval?', 'Which single first-party metric should be primary after approval?'],
    production_authority: 'NONE',
    external_effect_count: 0,
  };
  return deepFreeze({ ...body, receipt_hash: hashCanonical(body) });
}

export function retrieveOwnerTaste({ learningReceipts, generation }) {
  assertMission(Array.isArray(learningReceipts) && learningReceipts.length > 0, 'LEARNING_RECEIPT_REQUIRED', 'At least one learning receipt is required');
  assertMission(Number.isInteger(generation) && generation > 1, 'NEXT_GENERATION_REQUIRED', 'Retrieval proof must target a later generation');
  const latest = [...learningReceipts].sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0];
  const { receipt_hash: claimed, ...body } = latest;
  assertMission(hashCanonical(body) === claimed, 'LEARNING_RECEIPT_INVALID', 'Learning receipt hash does not recompute');
  return deepFreeze({
    schema_version: 'cana.owner-taste-retrieval/1.0.0',
    source_receipt_hash: claimed,
    applied_to_generation: generation,
    avoid: [...latest.source_owner_rejection_tags],
    prefer: [...PR21_PREFERENCE_PAIR.desired.qualities],
    owner_approved_winner: null,
    next_mutation: latest.next_mutation,
    production_authority: 'NONE',
  });
}
