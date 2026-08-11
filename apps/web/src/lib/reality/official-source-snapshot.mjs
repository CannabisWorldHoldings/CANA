import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const ABCA_SOURCE_ID = 'dcgis:abca:licensed-medical-cannabis-retailers:layer-31';
export const ABCA_LAYER_URL = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31';
export const ABCA_QUERY_URL = `${ABCA_LAYER_URL}/query`;
export const ABCA_FIELDS = Object.freeze([
  'OBJECTID',
  'GLOBALID',
  'ABCA_NUMBER',
  'FACILITY_NAME',
  'FACILITY_TYPE',
  'LICENSE_TYPE',
  'EXPIRATION_DATE',
  'ADDRESS',
  'LATITUDE',
  'LONGITDUE',
  'TRADE_NAME',
  'ENTITY_NAME',
  'STATUS',
  'ISSUE_DATE',
  'EDITED',
  'WARD',
  'ENDORSEMENTS',
]);

export const OFFICIAL_SOURCE_SCHEMA_VERSION = 'cana-dc-abca-arcgis-snapshot-v1';

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertVersionBoundCapturePage({ exceededTransferLimit, featureCount, pageSize }) {
  if (!Number.isInteger(featureCount) || featureCount < 0 || !Number.isInteger(pageSize) || pageSize < 1) {
    fail('CANA_OFFICIAL_SOURCE_PAGINATION_INVALID', 'invalid capture page shape');
  }
  if (exceededTransferLimit === true || exceededTransferLimit !== false && featureCount >= pageSize) {
    fail('CANA_OFFICIAL_SOURCE_UNVERSIONED_MULTIPAGE_REFUSED', 'layer 31 exposes no revision-bound pagination');
  }
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(code, error.message);
  }
}

function exactFile(directory, name) {
  const root = path.resolve(directory);
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) fail('CANA_OFFICIAL_SOURCE_PATH_INVALID', name);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('CANA_OFFICIAL_SOURCE_PATH_INVALID', target);
  return target;
}

function decodePart(encoded, inventory, label) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    fail('CANA_OFFICIAL_SOURCE_BASE64_INVALID', label);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== inventory.byte_length || sha256(bytes) !== inventory.sha256) {
    fail('CANA_OFFICIAL_SOURCE_PART_DIGEST_MISMATCH', label);
  }
  return bytes;
}

function validateRecord(record, seenObjectIds, seenGlobalIds, seenLicenses, previousObjectId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('CANA_OFFICIAL_SOURCE_RECORD_INVALID', 'record is not an object');
  }
  for (const field of ABCA_FIELDS) {
    if (!Object.hasOwn(record, field)) fail('CANA_OFFICIAL_SOURCE_FIELD_MISSING', field);
  }
  const objectId = Number(record.OBJECTID);
  if (!Number.isInteger(objectId) || objectId <= previousObjectId || seenObjectIds.has(objectId)) {
    fail('CANA_OFFICIAL_SOURCE_OBJECTID_ORDER_INVALID', String(record.OBJECTID));
  }
  seenObjectIds.add(objectId);
  const globalId = String(record.GLOBALID ?? '').trim().toUpperCase();
  if (!globalId || seenGlobalIds.has(globalId)) fail('CANA_OFFICIAL_SOURCE_GLOBALID_DUPLICATE', globalId || 'missing');
  seenGlobalIds.add(globalId);
  const license = String(record.ABCA_NUMBER ?? '').trim().toUpperCase();
  if (!license || seenLicenses.has(license)) fail('CANA_OFFICIAL_SOURCE_LICENSE_DUPLICATE', license || 'missing');
  seenLicenses.add(license);
  return objectId;
}

export function loadOfficialSourceSnapshot(directory) {
  const root = path.resolve(directory);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('CANA_OFFICIAL_SOURCE_PATH_INVALID', root);
  const manifestBytes = readFileSync(exactFile(root, 'manifest.json'));
  const snapshotBytes = readFileSync(exactFile(root, 'snapshot.json'));
  return validateOfficialSourceSnapshotBytes({ manifestBytes, snapshotBytes });
}

export function validateOfficialSourceSnapshotBytes({ manifestBytes, snapshotBytes }) {
  if (!Buffer.isBuffer(manifestBytes) || !Buffer.isBuffer(snapshotBytes)) {
    fail('CANA_OFFICIAL_SOURCE_CAPTURE_INVALID', 'manifest and snapshot bytes are required');
  }
  const manifest = parseJson(manifestBytes, 'CANA_OFFICIAL_SOURCE_MANIFEST_INVALID');
  if (manifest.schema_version !== OFFICIAL_SOURCE_SCHEMA_VERSION || manifest.source_id !== ABCA_SOURCE_ID) {
    fail('CANA_OFFICIAL_SOURCE_CONTRACT_MISMATCH', 'schema or source id');
  }
  if (manifest.snapshot_byte_length !== snapshotBytes.length || manifest.snapshot_sha256 !== sha256(snapshotBytes)) {
    fail('CANA_OFFICIAL_SOURCE_SNAPSHOT_DIGEST_MISMATCH', 'snapshot.json');
  }
  if (JSON.stringify(manifest.fields) !== JSON.stringify(ABCA_FIELDS)) {
    fail('CANA_OFFICIAL_SOURCE_FIELDS_MISMATCH', 'outFields');
  }
  const envelope = parseJson(snapshotBytes, 'CANA_OFFICIAL_SOURCE_SNAPSHOT_INVALID');
  if (envelope.schema_version !== OFFICIAL_SOURCE_SCHEMA_VERSION || envelope.source_id !== ABCA_SOURCE_ID) {
    fail('CANA_OFFICIAL_SOURCE_CONTRACT_MISMATCH', 'snapshot envelope');
  }
  if (!Array.isArray(envelope.pages) || envelope.pages.length === 0 || envelope.pages.length !== manifest.pages.length) {
    fail('CANA_OFFICIAL_SOURCE_PAGINATION_INVALID', 'page inventory');
  }
  const metadataBytes = decodePart(envelope.metadata_base64, manifest.metadata, 'metadata');
  const metadata = parseJson(metadataBytes, 'CANA_OFFICIAL_SOURCE_ARCGIS_ERROR');
  if (metadata.error || metadata.id !== 31 || metadata.maxRecordCount < 1) {
    fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', 'layer metadata');
  }

  const records = [];
  const rawPages = [];
  const seenObjectIds = new Set();
  const seenGlobalIds = new Set();
  const seenLicenses = new Set();
  let previousObjectId = -Infinity;
  for (let index = 0; index < envelope.pages.length; index += 1) {
    const pageEnvelope = envelope.pages[index];
    const inventory = manifest.pages[index];
    if (pageEnvelope.offset !== inventory.offset || index > 0 && pageEnvelope.offset <= envelope.pages[index - 1].offset) {
      fail('CANA_OFFICIAL_SOURCE_PAGINATION_INVALID', `page ${index}`);
    }
    const pageBytes = decodePart(pageEnvelope.response_base64, inventory, `page ${index}`);
    rawPages.push(pageBytes);
    const page = parseJson(pageBytes, 'CANA_OFFICIAL_SOURCE_ARCGIS_ERROR');
    if (page.error || !Array.isArray(page.features) || page.features.length !== inventory.record_count) {
      fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', `page ${index}`);
    }
    if (index === envelope.pages.length - 1 && page.exceededTransferLimit === true) {
      fail('CANA_OFFICIAL_SOURCE_PAGINATION_INVALID', 'final page is incomplete');
    }
    for (const feature of page.features) {
      const record = { ...feature.attributes, geometry: feature.geometry ?? null };
      previousObjectId = validateRecord(record, seenObjectIds, seenGlobalIds, seenLicenses, previousObjectId);
      records.push(Object.freeze(record));
    }
  }
  if (records.length !== manifest.record_count) {
    fail('CANA_OFFICIAL_SOURCE_RECORD_COUNT_MISMATCH', `${records.length} != ${manifest.record_count}`);
  }
  return Object.freeze({
    source_id: ABCA_SOURCE_ID,
    fetched_at: manifest.fetched_at,
    source_modified_at: manifest.source_modified_at,
    source_catalog_modified_date: manifest.source_catalog_modified_date,
    record_count: records.length,
    records: Object.freeze(records),
    raw_query_pages: Object.freeze(rawPages),
    manifest: Object.freeze(manifest),
    snapshot_bytes: snapshotBytes,
    snapshot_sha256: manifest.snapshot_sha256,
  });
}

export function buildSnapshotArtifacts({
  metadataBytes,
  pageParts,
  fetchedAt,
  sourceModifiedAt = null,
  sourceCatalogModifiedDate = '2026-06-05',
  provenanceMode = 'FIXTURE',
}) {
  if (!Buffer.isBuffer(metadataBytes) || !Array.isArray(pageParts) || pageParts.length === 0) {
    fail('CANA_OFFICIAL_SOURCE_CAPTURE_INVALID', 'metadata and pages are required');
  }
  if (!['FIXTURE', 'LIVE'].includes(provenanceMode)) {
    fail('CANA_OFFICIAL_SOURCE_CAPTURE_INVALID', 'provenance mode');
  }
  if (provenanceMode === 'LIVE' && sourceCatalogModifiedDate !== null) {
    fail('CANA_LIVE_REALITY_FIXTURE_METADATA_REFUSED', 'live catalog metadata must be observed or UNKNOWN');
  }
  const metadata = parseJson(metadataBytes, 'CANA_OFFICIAL_SOURCE_ARCGIS_ERROR');
  if (metadata.error || metadata.id !== 31) fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', 'metadata');
  const pages = pageParts.map(({ offset, bytes }) => ({
    offset,
    response_base64: bytes.toString('base64'),
  }));
  const envelope = {
    schema_version: OFFICIAL_SOURCE_SCHEMA_VERSION,
    source_id: ABCA_SOURCE_ID,
    metadata_base64: metadataBytes.toString('base64'),
    pages,
  };
  const snapshotBytes = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`);
  const inventory = pageParts.map(({ offset, bytes }) => {
    const page = parseJson(bytes, 'CANA_OFFICIAL_SOURCE_ARCGIS_ERROR');
    if (page.error || !Array.isArray(page.features)) fail('CANA_OFFICIAL_SOURCE_ARCGIS_ERROR', `page ${offset}`);
    return { offset, record_count: page.features.length, byte_length: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = {
    schema_version: OFFICIAL_SOURCE_SCHEMA_VERSION,
    source_id: ABCA_SOURCE_ID,
    endpoint: ABCA_LAYER_URL,
    query_endpoint: ABCA_QUERY_URL,
    query: {
      where: '1=1',
      outFields: ABCA_FIELDS.join(','),
      orderByFields: 'OBJECTID',
      returnGeometry: 'true',
      f: 'json',
    },
    fields: [...ABCA_FIELDS],
    fetched_at: new Date(fetchedAt).toISOString(),
    provenance_mode: provenanceMode,
    source_catalog_modified_date: sourceCatalogModifiedDate,
    source_modified_at: sourceModifiedAt,
    metadata: { byte_length: metadataBytes.length, sha256: sha256(metadataBytes) },
    pages: inventory,
    record_count: inventory.reduce((sum, page) => sum + page.record_count, 0),
    snapshot_byte_length: snapshotBytes.length,
    snapshot_sha256: sha256(snapshotBytes),
  };
  return Object.freeze({
    snapshotBytes,
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    manifest,
  });
}
