import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ABCA_FIELDS,
  ABCA_LAYER_URL,
  ABCA_QUERY_URL,
  assertVersionBoundCapturePage,
  buildSnapshotArtifacts,
} from '../src/lib/reality/official-source-snapshot.mjs';

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'CANA-Reality-Compiler/1.0' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail('CANA_OFFICIAL_SOURCE_HTTP_ERROR', `${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  let body;
  try {
    body = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', error.message);
  }
  if (body.error) fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', JSON.stringify(body.error));
  return { bytes, body };
}

async function main() {
  if (process.env.CI) fail('CANA_OFFICIAL_SOURCE_NETWORK_REFUSED_IN_CI', 'capture is maintenance-only');
  if (!process.argv.includes('--allow-network')) fail('CANA_OFFICIAL_SOURCE_NETWORK_AUTHORITY_REQUIRED', '--allow-network');
  const output = option('--output');
  if (!output) fail('CANA_OFFICIAL_SOURCE_OUTPUT_REQUIRED', '--output');
  const target = path.resolve(output);
  if (existsSync(target)) fail('CANA_OFFICIAL_SOURCE_OUTPUT_EXISTS', target);

  const metadataUrl = new URL(ABCA_LAYER_URL);
  metadataUrl.searchParams.set('f', 'json');
  const metadataPart = await fetchBytes(metadataUrl);
  const maxRecordCount = Number(metadataPart.body.maxRecordCount);
  if (!Number.isInteger(maxRecordCount) || maxRecordCount < 1) {
    fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', 'invalid maxRecordCount');
  }
  const pageSize = Math.min(maxRecordCount, 500);
  const pageParts = [];
  for (let offset = 0; ; offset += pageSize) {
    const queryUrl = new URL(ABCA_QUERY_URL);
    queryUrl.searchParams.set('f', 'json');
    queryUrl.searchParams.set('where', '1=1');
    queryUrl.searchParams.set('outFields', ABCA_FIELDS.join(','));
    queryUrl.searchParams.set('returnGeometry', 'true');
    queryUrl.searchParams.set('outSR', '4326');
    queryUrl.searchParams.set('orderByFields', 'OBJECTID');
    queryUrl.searchParams.set('resultOffset', String(offset));
    queryUrl.searchParams.set('resultRecordCount', String(pageSize));
    const page = await fetchBytes(queryUrl);
    if (!Array.isArray(page.body.features)) fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', `features at ${offset}`);
    pageParts.push({ offset, bytes: page.bytes });
    assertVersionBoundCapturePage({
      exceededTransferLimit: page.body.exceededTransferLimit,
      featureCount: page.body.features.length,
      pageSize,
    });
    break;
  }

  const sourceModifiedAt = Number.isFinite(metadataPart.body?.editingInfo?.lastEditDate)
    ? new Date(metadataPart.body.editingInfo.lastEditDate).toISOString()
    : null;
  const artifacts = buildSnapshotArtifacts({
    metadataBytes: metadataPart.bytes,
    pageParts,
    fetchedAt: new Date(),
    sourceModifiedAt,
  });
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  mkdirSync(target, { recursive: false, mode: 0o755 });
  writeFileSync(path.join(target, 'snapshot.json'), artifacts.snapshotBytes, { mode: 0o644 });
  writeFileSync(path.join(target, 'manifest.json'), artifacts.manifestBytes, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({
    overall: 'PASS',
    output: target,
    record_count: artifacts.manifest.record_count,
    snapshot_sha256: artifacts.manifest.snapshot_sha256,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? error}\n`);
  process.exitCode = 1;
});
