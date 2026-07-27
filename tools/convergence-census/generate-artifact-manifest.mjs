#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolRoot, '../..');
const artifactRoot = path.join(repositoryRoot, 'docs/convergence/mission-1');
const outputPath = path.join(artifactRoot, 'ARTIFACT_MANIFEST.json');

const paths = [
  'docs/convergence/mission-1/SOURCE_LEDGER.md',
  'docs/convergence/mission-1/INPUT_HASHES.json',
  'docs/convergence/mission-1/CANONICAL_COMPONENT_MAP.md',
  'docs/convergence/mission-1/COMPONENT_DISPOSITION.md',
  'docs/convergence/mission-1/DUPLICATE_AUTHORITY_REPORT.md',
  'docs/convergence/mission-1/AUTHORITY_CONTRACT.md',
  'docs/convergence/mission-1/HERMES_PIN_RESOLUTION.md',
  'docs/convergence/mission-1/MINIMUM_ALIVE_LOOP_SPEC.md',
  'docs/convergence/mission-1/INTELLIGENCE_OS_RECOVERY_STATUS.md',
  'docs/convergence/mission-1/RUNTIME_INCLUSION_MANIFEST.json',
  'docs/convergence/mission-1/CONVERGENCE_ROLLBACK_PLAN.md',
  'docs/convergence/mission-1/LOCAL_VERIFICATION_RECEIPTS.json',
  'tools/convergence-census/generate-input-hashes.mjs',
  'tools/convergence-census/generate-artifact-manifest.mjs',
  'tools/convergence-census/verify.mjs',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const artifacts = paths.map((relativePath) => {
  const bytes = fs.readFileSync(path.join(repositoryRoot, relativePath));
  return {
    path: relativePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
});

const document = {
  schema_version: '1.0.0',
  generated_at:
    process.env.CANA_CENSUS_GENERATED_AT || '2026-07-27T00:00:00.000Z',
  hash_algorithm: 'SHA-256',
  scope:
    'The 11 required Mission 1 deliverables, durable local receipts, and all census tools. This manifest intentionally does not hash itself.',
  artifacts,
  artifact_set_sha256: sha256(
    artifacts
      .map(({ path: relativePath, bytes, sha256: digest }) =>
        [relativePath, bytes, digest].join('\0'),
      )
      .join('\n'),
  ),
};

fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output: outputPath,
      artifacts: document.artifacts.length,
      artifact_set_sha256: document.artifact_set_sha256,
    },
    null,
    2,
  ),
);
