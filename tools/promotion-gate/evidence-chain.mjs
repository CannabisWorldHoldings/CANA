import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sha256File } from '../test-runner/receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'c953ebcd25c46ef33af0700d7913a899d839bce8';
const DEMAND_CREDITS = 'apps/web/src/lib/demand-credits.mjs';
const HANDOFF_ROUTE = 'apps/web/src/app/[domain]/retailer/[id]/handoff/route.ts';
const MARIA_RUNNER = 'tools/mariadb-sim/run.mjs';

const MARIA_TEXT_BYTES = 65_535;
const TECHNICAL_STORAGE_BYTES = 60_000;
const MAX_LINKS = 64;
const MAX_STEP_BYTES = 128;
const MAX_REF_BYTES = 768;

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`);
  }
  return result;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function asciiChainBytes(linkCount, stepBytes, refBytes) {
  for (const value of [linkCount, stepBytes, refBytes]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError('chain dimensions must be positive safe integers');
    }
  }
  // JSON.stringify([{step:'',ref:''}]) is 22 bytes. Each additional object
  // contributes its two strings, a 20-byte object frame, and one comma.
  return 1 + linkCount * (21 + stepBytes + refBytes);
}

function measuredFixture(name, chain) {
  const json = JSON.stringify(chain);
  return {
    name,
    linkCount: chain.length,
    jsonUtf8Bytes: Buffer.byteLength(json),
    sha256: sha256(json),
  };
}

function currentHandoffMeasurement() {
  return measuredFixture('current five-link handoff', [
    { step: 'tenant_resolved', ref: 'orderweeddc.localhost#c1a2b3d4-e5f6-7890-abcd-ef1234567890' },
    { step: 'same_origin_form_post', ref: '/retailer/c1a2b3d4-e5f6-7890-abcd-ef1234567890/handoff' },
    { step: 'destination_verified', ref: 'https://www.example-dispensary-washington-dc.com/menu/order-online' },
    { step: 'page_challenge', ref: 'VERIFIED' },
    { step: 'interaction_graded', ref: 'MERCHANT_HANDOFF_VERIFIED' },
  ]);
}

function binding(relative) {
  return sha256File(path.join(ROOT, relative));
}

function prohibitedSourcesChanged() {
  return git(
    ['diff', '--quiet', BASE, 'HEAD', '--', DEMAND_CREDITS, HANDOFF_ROUTE],
    { allowFailure: true },
  ).status !== 0;
}

export function analyzeEvidenceChain() {
  const commit = git(['rev-parse', 'HEAD']).stdout.trim();
  const tree = git(['rev-parse', 'HEAD^{tree}']).stdout.trim();
  const current = currentHandoffMeasurement();
  const expectedTenLinkBytes = asciiChainBytes(10, 64, 512);
  const technicalEnvelopeBytes = asciiChainBytes(MAX_LINKS, MAX_STEP_BYTES, MAX_REF_BYTES);
  const adversarialAsciiBytes = asciiChainBytes(MAX_LINKS, 1024 * 1024, 1024 * 1024);
  const escapedControlBytes = asciiChainBytes(
    MAX_LINKS,
    6 * 1024 * 1024,
    6 * 1024 * 1024,
  );

  const report = {
    schemaVersion: 1,
    kind: 'CANA evidence-chain technical limit analysis',
    overall: 'PASS',
    source: {
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(),
      commit,
      tree,
      workingTreeClean: git(['status', '--porcelain']).stdout.trim() === '',
    },
    measurements: {
      currentHandoff: current,
      expectedTenLink: {
        name: 'expected ten-link planning envelope',
        linkCount: 10,
        stepUtf8Bytes: 64,
        refUtf8Bytes: 512,
        jsonUtf8Bytes: expectedTenLinkBytes,
      },
      technicalEnvelope64Link: {
        name: 'recommended technical envelope at the existing link cap',
        linkCount: MAX_LINKS,
        stepUtf8Bytes: MAX_STEP_BYTES,
        refUtf8Bytes: MAX_REF_BYTES,
        jsonUtf8Bytes: technicalEnvelopeBytes,
      },
      adversarialAscii64Link: {
        name: 'current-validator adversarial ASCII payload',
        linkCount: MAX_LINKS,
        stepUtf8Bytes: 1024 * 1024,
        refUtf8Bytes: 1024 * 1024,
        jsonUtf8Bytes: adversarialAsciiBytes,
      },
      adversarialEscapedControl64Link: {
        name: 'current-validator adversarial JSON-escaped control payload',
        linkCount: MAX_LINKS,
        logicalStepCodeUnits: 1024 * 1024,
        logicalRefCodeUnits: 1024 * 1024,
        jsonUtf8Bytes: escapedControlBytes,
      },
    },
    database: {
      providerCandidate: 'MariaDB 11.4',
      columnType: 'TEXT',
      hardBytes: MARIA_TEXT_BYTES,
      executedBoundaryProof: true,
      strictOverflow: 'REJECTS',
      nonStrictOverflow: 'TRUNCATES_AND_BREAKS_JSON_AND_DIGEST',
    },
    recommendation: {
      technicalStorageCeilingBytes: TECHNICAL_STORAGE_BYTES,
      headroomBytes: MARIA_TEXT_BYTES - TECHNICAL_STORAGE_BYTES,
      maxLinks: MAX_LINKS,
      maxStepUtf8Bytes: MAX_STEP_BYTES,
      maxRefUtf8Bytes: MAX_REF_BYTES,
      apiRequestCeilingBytes: 256 * 1024,
      overflowBehavior: 'FAIL_CLOSED_BEFORE_DATABASE',
      overflowStatus: 413,
      overflowDenialCode: 'EVIDENCE_CHAIN_BYTES_EXCEEDED',
      reporting: 'LIST_BY_DIGEST_AND_BYTE_LENGTH; FETCH_FULL_CHAIN_SEPARATELY',
    },
    consequences: {
      database: 'OVERFLOW_REJECTS_IN_STRICT_MODE_AND_CORRUPTS_IN_NON_STRICT_MODE',
      memory: 'JSON_SERIALIZATION_AND_HASHING_SCALE_LINEARLY_WITH_UNBOUNDED_LINK_BYTES',
      api: 'UNBOUNDED_INPUT_CAN_EXCEED_REQUEST_AND_RESPONSE_BUDGETS',
      reporting: 'INLINE_EXPORT_GROWS_WITH_EVERY_STORED_CHAIN',
    },
    policy: {
      businessApproved: false,
      appliedToBusinessLogic: false,
      boundary:
        'This is a technical safety recommendation, not an evidence-grade, merchant-value, or business-approved policy.',
      approvalNeeded:
        'Chief Integrator or owner approval is required before changing application acceptance behavior.',
    },
    bindings: {
      demandCreditsFile: DEMAND_CREDITS,
      demandCreditsSha256: binding(DEMAND_CREDITS),
      handoffRouteFile: HANDOFF_ROUTE,
      handoffRouteSha256: binding(HANDOFF_ROUTE),
      mariaRunnerFile: MARIA_RUNNER,
      mariaRunnerSha256: binding(MARIA_RUNNER),
      prohibitedSourceChanged: prohibitedSourcesChanged(),
    },
    hostedEnvironment: 'UNPROVEN',
  };

  if (
    current.jsonUtf8Bytes !== 405 ||
    expectedTenLinkBytes !== 5_971 ||
    technicalEnvelopeBytes !== 58_689 ||
    technicalEnvelopeBytes > TECHNICAL_STORAGE_BYTES ||
    TECHNICAL_STORAGE_BYTES >= MARIA_TEXT_BYTES ||
    report.bindings.prohibitedSourceChanged
  ) {
    throw new Error(`evidence-chain analysis invariant failed: ${JSON.stringify(report)}`);
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(analyzeEvidenceChain(), null, 2)}\n`);
}
