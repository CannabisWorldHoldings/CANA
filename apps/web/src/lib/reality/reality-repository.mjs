import { randomUUID } from 'node:crypto';

import {
  MARKET_CLAIM_COURT_VERSION,
  adjudicateAcquisitionEvidence,
  adjudicateMarketClaim,
  adjudicateZeroChangeReattestation,
} from './market-claim-court.mjs';
import { normalizeCoordinates } from './entity-resolution.mjs';
import {
  loadOfficialSourceSnapshot,
  validateOfficialSourceSnapshotBytes,
} from './official-source-snapshot.mjs';
import { computeFreshnessDebt, scheduleFreshnessRevalidation } from './freshness-debt.mjs';
import {
  DC_ABCA_SOURCE,
  canonicalDigest,
  createEvidenceSnapshot,
  compileRealitySnapshot,
  contradictoryObservationIds,
  parseAbcaSnapshot,
} from './reality-compiler.mjs';

export const PUBLIC_REALITY_PROJECTION_TENANT = 'orderweeddc.com';

const MAX_IDENTITY_CANDIDATES = 5_000;
const MAX_RELEVANT_CLAIM_HISTORY = 20_000;

const TENANT_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

function tenantKey(value) {
  const tenant = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!TENANT_PATTERN.test(tenant)) throw new Error('CANA_REALITY_TENANT_INVALID');
  return tenant;
}

function serialized(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function observationTime(loaded) {
  return loaded.observation_time
    ?? loaded.source_modified_at
    ?? `${loaded.source_catalog_modified_date}T00:00:00.000Z`;
}

function liveLoadedSnapshot(acquisition) {
  let parameters;
  try {
    parameters = JSON.parse(acquisition.snapshot.queryParameters);
  } catch {
    throw new Error('CANA_REALITY_LIVE_MANIFEST_MISSING');
  }
  const encoded = parameters?.manifest_base64;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('CANA_REALITY_LIVE_MANIFEST_MISSING');
  }
  const snapshotBytes = Buffer.from(acquisition.snapshot.payloadJson, 'utf8');
  const loaded = validateOfficialSourceSnapshotBytes({
    manifestBytes: Buffer.from(encoded, 'base64'),
    snapshotBytes,
  });
  if (loaded.snapshot_sha256 !== acquisition.contentArtifact.contentSha256) {
    throw new Error('CANA_REALITY_LIVE_CONTENT_DIGEST_MISMATCH');
  }
  return Object.freeze({ ...loaded, observation_time: acquisition.fetchedAt.toISOString() });
}

function assertAdmittedAcquisition(acquisition, { tenant, purpose, asOf }) {
  const decision = adjudicateAcquisitionEvidence({
    event: acquisition,
    artifact: acquisition?.contentArtifact,
    snapshot: acquisition?.snapshot,
    tenant,
    purpose,
    asOf,
  });
  if (decision.decision !== 'ALLOW') throw new Error(`CANA_REALITY_${decision.reason}`);
  return decision;
}

function storedObservationTime(snapshot) {
  if (snapshot.sourceModifiedAt instanceof Date && Number.isFinite(snapshot.sourceModifiedAt.getTime())) {
    return snapshot.sourceModifiedAt.toISOString();
  }
  let parameters;
  try {
    parameters = JSON.parse(snapshot.queryParameters);
  } catch {
    throw new Error('CANA_REALITY_SOURCE_OBSERVATION_TIME_MISSING');
  }
  const catalogDate = parameters?.source_catalog_modified_date;
  if (typeof catalogDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(catalogDate)) {
    throw new Error('CANA_REALITY_SOURCE_OBSERVATION_TIME_MISSING');
  }
  return `${catalogDate}T00:00:00.000Z`;
}

function runtimeSnapshot(loaded) {
  return createEvidenceSnapshot({
    sourceId: DC_ABCA_SOURCE.source_id,
    payloadPages: loaded.raw_query_pages.map((bytes, index) => ({
      offset: loaded.manifest.pages[index].offset,
      bytes,
    })),
    fetchedAt: observationTime(loaded),
    completeness: 'COMPLETE',
  });
}

async function createGeoIdentity(tx, { retailer, record, license, loaded }) {
  const coordinates = normalizeCoordinates(record);
  if (coordinates.state !== 'KNOWN') return null;
  const geoEntity = await tx.geoEntity.create({
    data: {
      name: retailer.name,
      lat: coordinates.lat,
      lng: coordinates.lng,
      retailerId: retailer.id,
      source: loaded.source_id,
      sourceUrl: DC_ABCA_SOURCE.source_url,
      observedAt: new Date(observationTime(loaded)),
      confidence: 1,
      verification: 'UNKNOWN',
    },
  });
  const licenseAlias = await tx.geoEntityAlias.create({
    data: {
      geoEntityId: geoEntity.id,
      namespace: 'dc_abca_license',
      externalId: license,
      observedAt: new Date(observationTime(loaded)),
      confidence: 1,
    },
  });
  const globalId = String(record.GLOBALID ?? '').trim().toUpperCase();
  if (globalId) {
    await tx.geoEntityAlias.create({
      data: {
        geoEntityId: geoEntity.id,
        namespace: 'dcgis_globalid',
        externalId: globalId,
        observedAt: new Date(observationTime(loaded)),
        confidence: 1,
      },
    });
  }
  retailer.geoEntityId = geoEntity.id;
  return { geoEntity, licenseAlias };
}

async function compileOfficialMarketSnapshotTransaction(prisma, {
  snapshotDirectory,
  tenant = 'orderweeddc.com',
  acquisitionEventId = null,
}) {
  tenant = tenantKey(tenant);
  let loaded = acquisitionEventId ? null : loadOfficialSourceSnapshot(snapshotDirectory);
  return prisma.$transaction(async (tx) => {
    let acquisition = null;
    let snapshotRow = null;
    if (acquisitionEventId) {
      acquisition = await tx.marketSourceAcquisitionEvent.findUnique({
        where: { id: acquisitionEventId },
        include: { contentArtifact: true, snapshot: true },
      });
      assertAdmittedAcquisition(acquisition, {
        tenant,
        purpose: 'COMPILE',
        asOf: acquisition?.completedAt,
      });
      loaded = liveLoadedSnapshot(acquisition);
      snapshotRow = acquisition.snapshot;
    }
    const snapshot = runtimeSnapshot(loaded);
    const parsed = parseAbcaSnapshot(snapshot);
    if (!snapshotRow) {
      snapshotRow = await tx.marketSourceSnapshot.findUnique({
        where: { sourceKey_payloadSha256: { sourceKey: loaded.source_id, payloadSha256: snapshot.sha256 } },
      });
    }
    if (!snapshotRow) {
      snapshotRow = await tx.marketSourceSnapshot.create({ data: {
        sourceKey: loaded.source_id,
        sourceUrl: DC_ABCA_SOURCE.source_url,
        queryParameters: JSON.stringify({
          ...loaded.manifest.query,
          fixture_snapshot_sha256: loaded.snapshot_sha256,
          source_catalog_modified_date: loaded.source_catalog_modified_date,
        }),
        fetchedAt: new Date(loaded.fetched_at),
        sourceModifiedAt: loaded.source_modified_at ? new Date(loaded.source_modified_at) : null,
        payloadSha256: snapshot.sha256,
        payloadBytes: snapshot.byte_length,
        recordCount: loaded.record_count,
        schemaVersion: loaded.manifest.schema_version,
        payloadJson: snapshot.payload_bytes.toString('utf8'),
        completeness: 'COMPLETE',
      } });
    }
    const existingCompilation = await tx.marketCompilation.findUnique({
      where: { tenant_snapshotId: { tenant, snapshotId: snapshotRow.id } },
      select: { id: true },
    });
    if (existingCompilation) return Object.freeze({ state: 'NOOP', snapshot_id: snapshotRow.id, compilation_id: existingCompilation.id, source_records: loaded.record_count });
    const compilation = await tx.marketCompilation.create({ data: {
      tenant,
      snapshotId: snapshotRow.id,
      contentArtifactId: acquisition?.contentArtifactId ?? null,
      acquisitionEventId: acquisition?.id ?? null,
    } });

    const sourceLicenses = [...new Set(parsed.records.map((entry) => entry.normalized_license))];
    const aliasRows = await tx.geoEntityAlias.findMany({
      where: { namespace: 'dc_abca_license', externalId: { in: sourceLicenses } },
      select: { id: true, namespace: true, externalId: true, geoEntityId: true },
      take: MAX_IDENTITY_CANDIDATES + 1,
    });
    if (aliasRows.length > MAX_IDENTITY_CANDIDATES) throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
    const directRetailers = await tx.retailer.findMany({
      where: {
        OR: sourceLicenses.map((licenseNumber) => ({
          licenseNumber: { equals: licenseNumber, mode: 'insensitive' },
        })),
      },
      select: { id: true, licenseNumber: true, name: true },
      take: MAX_IDENTITY_CANDIDATES + 1,
    });
    if (directRetailers.length > MAX_IDENTITY_CANDIDATES) throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
    const geoEntities = await tx.geoEntity.findMany({
      where: {
        OR: [
          { retailerId: { in: directRetailers.map((retailer) => retailer.id) } },
          { id: { in: aliasRows.map((alias) => alias.geoEntityId) } },
        ],
      },
      select: { id: true, retailerId: true },
      take: MAX_IDENTITY_CANDIDATES + 1,
    });
    if (geoEntities.length > MAX_IDENTITY_CANDIDATES) throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
    const directIds = new Set(directRetailers.map((retailer) => retailer.id));
    const linkedRetailerIds = [...new Set(geoEntities
      .map((entity) => entity.retailerId)
      .filter((retailerId) => retailerId && !directIds.has(retailerId)))];
    const linkedRetailers = linkedRetailerIds.length === 0 ? [] : await tx.retailer.findMany({
      where: { id: { in: linkedRetailerIds } },
      select: { id: true, licenseNumber: true, name: true },
      take: MAX_IDENTITY_CANDIDATES + 1,
    });
    if (directRetailers.length + linkedRetailers.length > MAX_IDENTITY_CANDIDATES) {
      throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
    }
    const retailers = [...directRetailers, ...linkedRetailers];
    const geoByRetailer = new Map(geoEntities.map((entity) => [entity.retailerId, entity.id]));
    for (const retailer of retailers) retailer.geoEntityId = geoByRetailer.get(retailer.id) ?? null;
    const retailerByGeo = new Map(geoEntities.map((entity) => [entity.id, entity.retailerId]));
    const aliases = aliasRows.map((alias) => ({ ...alias, retailerId: retailerByGeo.get(alias.geoEntityId) ?? null }));

    const parsedByLicense = new Map(parsed.records.map((entry) => [entry.normalized_license, entry]));
    for (const retailer of retailers) {
      if (retailer.geoEntityId) continue;
      const license = String(retailer.licenseNumber ?? '').normalize('NFKC').trim().toUpperCase();
      const parsedRecord = parsedByLicense.get(license);
      if (!parsedRecord) continue;
      const created = await createGeoIdentity(tx, {
        retailer,
        record: parsedRecord.record,
        license,
        loaded,
      });
      if (created) aliases.push({ ...created.licenseAlias, retailerId: retailer.id });
    }

    const compiled = compileRealitySnapshot({ snapshot, tenant, retailers, aliases });
    await tx.marketObservation.createMany({
      data: compiled.observations.map((item) => ({
        snapshotId: snapshotRow.id,
        sourceRecordId: item.source_record_key,
        sourceRecordSha256: item.source_record_sha256,
        fieldName: item.predicate,
        rawValue: serialized(item.raw_value),
        normalizedValue: serialized(item.value),
        observedAt: new Date(item.observed_at),
        freshnessExpiresAt: new Date(new Date(item.observed_at).getTime() + DC_ABCA_SOURCE.max_age_ms),
        confidence: 1,
        uncertaintyJson: null,
      })),
      skipDuplicates: true,
    });
    const storedObservations = await tx.marketObservation.findMany({
      where: { snapshotId: snapshotRow.id },
      select: { id: true, sourceRecordId: true, fieldName: true },
    });
    const storedObservationByKey = new Map(storedObservations.map((row) => [
      `${row.sourceRecordId}:${row.fieldName}`,
      row.id,
    ]));
    const observationRows = new Map();
    for (const item of compiled.observations) {
      const storedId = storedObservationByKey.get(`${item.source_record_key}:${item.predicate}`);
      if (!storedId) throw new Error('CANA_REALITY_OBSERVATION_BINDING_MISSING');
      observationRows.set(item.observation_id, storedId);
    }

    const resolutionData = compiled.resolutions.map((item) => {
      const record = parsed.records.find((entry) => entry.record_hash === item.source_record_sha256);
      const retailer = retailers.find((entry) => entry.id === item.retailer_id);
      return {
        snapshotId: snapshotRow.id,
        compilationId: compilation.id,
        sourceRecordId: record.normalized_license,
        sourceRecordSha256: record.record_hash,
        normalizedLicense: record.normalized_license,
        normalizedName: String(record.record.FACILITY_NAME ?? record.record.TRADE_NAME ?? '').trim() || null,
        normalizedAddress: String(record.record.ADDRESS ?? '').trim() || null,
        status: item.status === 'EXACT_MATCH' ? 'MATCH' : item.status,
        reason: item.method,
        candidateIds: JSON.stringify(item.candidate_ids),
        normalizationVersion: item.normalization_version,
        retailerId: item.retailer_id ?? null,
        geoEntityId: retailer?.geoEntityId ?? item.geo_entity_id ?? null,
      };
    });
    await tx.marketEntityResolution.createMany({ data: resolutionData });
    const storedResolutions = await tx.marketEntityResolution.findMany({
      where: { compilationId: compilation.id },
      select: { id: true, sourceRecordId: true },
    });
    const resolutionRows = new Map();
    for (const row of storedResolutions) {
      resolutionRows.set(row.sourceRecordId, row.id);
    }

    const claimKeys = compiled.claims.map((item) => `${item.subject_id}:${item.predicate}`);
    const priorClaimRows = claimKeys.length === 0 ? [] : await tx.marketClaim.findMany({
      where: { tenant, claimKey: { in: claimKeys } },
      orderBy: [{ claimKey: 'asc' }, { version: 'desc' }],
      include: { evidence: true },
      take: MAX_RELEVANT_CLAIM_HISTORY + 1,
    });
    if (priorClaimRows.length > MAX_RELEVANT_CLAIM_HISTORY) {
      throw new Error('CANA_REALITY_CLAIM_HISTORY_BUDGET_EXCEEDED');
    }
    const priorClaimsByKey = new Map();
    for (const prior of priorClaimRows) {
      const entries = priorClaimsByKey.get(prior.claimKey) ?? [];
      entries.push(prior);
      priorClaimsByKey.set(prior.claimKey, entries);
    }
    const newClaims = [];
    const newEvidence = [];
    const newContradictions = [];
    for (const item of compiled.claims) {
      const claimKey = `${item.subject_id}:${item.predicate}`;
      const priorClaims = priorClaimsByKey.get(claimKey) ?? [];
      const prior = priorClaims[0] ?? null;
      const conflictingObservationIds = contradictoryObservationIds(
        { claimKey, claimValue: serialized(item.value) },
        priorClaims.map((entry) => ({
          claimKey: entry.claimKey,
          claimValue: entry.claimValue,
          observationIds: entry.evidence.filter((evidence) => evidence.role === 'SUPPORTS').map((evidence) => evidence.observationId),
        })),
      );
      const claim = {
          id: randomUUID(),
          tenant,
          claimKey,
          claimType: item.predicate,
          claimValue: serialized(item.value),
          version: (prior?.version ?? 0) + 1,
          resolutionId: resolutionRows.get(item.source_record_key),
          snapshotId: snapshotRow.id,
          compilationId: compilation.id,
          supersedesClaimId: prior?.id ?? null,
          observedAt: new Date(item.observed_at),
          freshnessExpiresAt: new Date(item.freshness_expires_at),
          confidence: item.confidence,
          uncertaintyJson: item.uncertainty,
          verification: conflictingObservationIds.length > 0 ? 'CONTRADICTED' : 'UNKNOWN',
          decisionEligible: false,
      };
      newClaims.push(claim);
      for (const observationId of item.observation_ids) {
        newEvidence.push({ claimId: claim.id, observationId: observationRows.get(observationId), role: 'SUPPORTS' });
      }
      const conflictingPrior = priorClaims.find((entry) => entry.claimValue !== serialized(item.value));
      if (conflictingPrior && conflictingObservationIds.length > 0) {
        const laterObservationIds = item.observation_ids.map((observationId) => {
          const storedId = observationRows.get(observationId);
          if (!storedId) throw new Error('CANA_REALITY_OBSERVATION_BINDING_MISSING');
          return storedId;
        });
        newContradictions.push({
            tenant,
            claimKey,
            earlierClaimId: conflictingPrior.id,
            laterClaimId: claim.id,
            earlierObservationIdsJson: JSON.stringify(conflictingObservationIds),
            laterObservationIdsJson: JSON.stringify(laterObservationIds),
            state: 'ACTIVE',
        });
        for (const observationId of conflictingObservationIds) {
          newEvidence.push({ claimId: claim.id, observationId, role: 'CONTRADICTS' });
        }
      }
    }
    if (newClaims.length > 0) await tx.marketClaim.createMany({ data: newClaims });
    if (newEvidence.length > 0) await tx.marketClaimEvidence.createMany({ data: newEvidence });
    if (newContradictions.length > 0) await tx.marketClaimContradiction.createMany({ data: newContradictions });
    return Object.freeze({
      state: 'COMPILED',
      snapshot_id: snapshotRow.id,
      source_records: loaded.record_count,
      observations: compiled.observations.length,
      resolutions: compiled.resolutions.length,
      claims: newClaims.length,
      compilation_id: compilation.id,
      acquisition_event_id: acquisition?.id ?? null,
      content_artifact_id: acquisition?.contentArtifactId ?? null,
      provisional_retailers: 0,
      contradictions: newContradictions.length,
      verification_events: 0,
      public_eligible_claims: 0,
    });
  }, { isolationLevel: 'Serializable', timeout: 60_000 });
}

function retryableTransaction(error) {
  return error?.code === 'P2034' || error?.code === 'P2002';
}

export async function compileOfficialMarketSnapshot(prisma, options) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await compileOfficialMarketSnapshotTransaction(prisma, options); } catch (error) {
      if (!retryableTransaction(error) || attempt === 2) throw error;
    }
  }
  throw new Error('CANA_REALITY_COMPILATION_RETRY_EXHAUSTED');
}

export async function compileLiveMarketAcquisition(prisma, { tenant, acquisitionEventId }) {
  if (typeof acquisitionEventId !== 'string' || acquisitionEventId.length === 0) {
    throw new Error('CANA_REALITY_ACQUISITION_EVENT_REQUIRED');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await compileOfficialMarketSnapshotTransaction(prisma, { tenant, acquisitionEventId });
    } catch (error) {
      if (!retryableTransaction(error) || attempt === 2) throw error;
    }
  }
  throw new Error('CANA_REALITY_COMPILATION_RETRY_EXHAUSTED');
}

function courtInput(claim, snapshot, evidenceSnapshot = null) {
  const supportingEvidence = claim.evidence.filter((entry) => entry.role === 'SUPPORTS');
  const evidence = supportingEvidence[0]?.observation;
  const boundSnapshot = evidenceSnapshot ?? createEvidenceSnapshot({
    sourceId: snapshot.sourceKey,
    payloadBytes: Buffer.from(snapshot.payloadJson),
    fetchedAt: storedObservationTime(snapshot),
    completeness: snapshot.completeness,
  });
  return {
    claim: {
      claim_id: claim.id,
      tenant: claim.tenant,
      subject_id: claim.resolution.retailerId ?? claim.resolution.geoEntityId,
      geo_entity_id: claim.resolution.geoEntityId ?? null,
      predicate: claim.claimType,
      value: claim.claimValue,
      source_id: boundSnapshot.source_id,
      source_url: boundSnapshot.source_url,
      snapshot_sha256: boundSnapshot.sha256,
      source_record_key: claim.resolution.sourceRecordId,
      source_record_sha256: claim.resolution.sourceRecordSha256,
      observation_ids: supportingEvidence.map((entry) => entry.observationId),
      supporting_observations: supportingEvidence.map((entry) => ({
        observation_id: entry.observationId,
        source_id: boundSnapshot.source_id,
        snapshot_sha256: boundSnapshot.sha256,
        source_record_key: entry.observation.sourceRecordId,
        source_record_sha256: entry.observation.sourceRecordSha256,
        predicate: entry.observation.fieldName,
        value: entry.observation.normalizedValue,
        observed_at: entry.observation.observedAt.toISOString(),
      })),
      contradictory_observation_ids: claim.evidence
        .filter((entry) => entry.role === 'CONTRADICTS')
        .map((entry) => entry.observationId)
        .sort(),
      observed_at: claim.observedAt.toISOString(),
      freshness_expires_at: claim.freshnessExpiresAt?.toISOString() ?? null,
      confidence: claim.confidence,
      uncertainty: claim.uncertaintyJson,
      resolution_status: claim.resolution.status === 'MATCH' ? 'EXACT_MATCH' : claim.resolution.status,
      resolution_method: claim.resolution.reason,
      evidence_value: evidence?.normalizedValue ?? null,
    },
    snapshot: boundSnapshot,
  };
}

async function loadCourtIdentityContext(tx, claims) {
  if (claims.length === 0) return { retailers: [], aliases: [] };
  const sourceLicenses = [...new Set(claims.map((claim) => claim.resolution.sourceRecordId))];
  const resolvedRetailerIds = [...new Set(claims
    .map((claim) => claim.resolution.retailerId)
    .filter(Boolean))];
  const resolvedGeoEntityIds = [...new Set(claims
    .map((claim) => claim.resolution.geoEntityId)
    .filter(Boolean))];
  const aliasRows = await tx.geoEntityAlias.findMany({
    where: { namespace: 'dc_abca_license', externalId: { in: sourceLicenses } },
    select: { id: true, namespace: true, externalId: true, geoEntityId: true },
    take: MAX_IDENTITY_CANDIDATES + 1,
  });
  if (aliasRows.length > MAX_IDENTITY_CANDIDATES) throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
  const directRetailers = await tx.retailer.findMany({
    where: {
      OR: [
        { id: { in: resolvedRetailerIds } },
        ...sourceLicenses.map((licenseNumber) => ({
          licenseNumber: { equals: licenseNumber, mode: 'insensitive' },
        })),
      ],
    },
    select: { id: true, licenseNumber: true },
    take: MAX_IDENTITY_CANDIDATES + 1,
  });
  if (directRetailers.length > MAX_IDENTITY_CANDIDATES) throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
  const geoEntities = await tx.geoEntity.findMany({
    where: {
      OR: [
        { retailerId: { in: directRetailers.map((retailer) => retailer.id) } },
        { id: { in: [...resolvedGeoEntityIds, ...aliasRows.map((alias) => alias.geoEntityId)] } },
      ],
    },
    select: { id: true, retailerId: true },
    take: MAX_IDENTITY_CANDIDATES + 1,
  });
  if (geoEntities.length > MAX_IDENTITY_CANDIDATES) throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
  const directIds = new Set(directRetailers.map((retailer) => retailer.id));
  const linkedRetailerIds = [...new Set(geoEntities
    .map((entity) => entity.retailerId)
    .filter((retailerId) => retailerId && !directIds.has(retailerId)))];
  const linkedRetailers = linkedRetailerIds.length === 0 ? [] : await tx.retailer.findMany({
    where: { id: { in: linkedRetailerIds } },
    select: { id: true, licenseNumber: true },
    take: MAX_IDENTITY_CANDIDATES + 1,
  });
  if (directRetailers.length + linkedRetailers.length > MAX_IDENTITY_CANDIDATES) {
    throw new Error('CANA_REALITY_IDENTITY_BUDGET_EXCEEDED');
  }
  const retailers = [...directRetailers, ...linkedRetailers];
  const geoByRetailer = new Map(geoEntities.map((entity) => [entity.retailerId, entity.id]));
  for (const retailer of retailers) retailer.geoEntityId = geoByRetailer.get(retailer.id) ?? null;
  const retailerByGeo = new Map(geoEntities.map((entity) => [entity.id, entity.retailerId]));
  const aliases = aliasRows.map((alias) => ({ ...alias, retailerId: retailerByGeo.get(alias.geoEntityId) ?? null }));
  return { retailers, aliases };
}

async function appendClaimState(tx, claim, { verification, decisionEligible }) {
  const latest = await tx.marketClaim.findFirst({
    where: { tenant: claim.tenant, claimKey: claim.claimKey },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const next = await tx.marketClaim.create({
    data: {
      tenant: claim.tenant,
      claimKey: claim.claimKey,
      claimType: claim.claimType,
      claimValue: claim.claimValue,
      version: (latest?.version ?? claim.version) + 1,
      resolutionId: claim.resolutionId,
      snapshotId: claim.snapshotId,
      compilationId: claim.compilationId,
      supersedesClaimId: claim.id,
      observedAt: claim.observedAt,
      freshnessExpiresAt: claim.freshnessExpiresAt,
      confidence: claim.confidence,
      uncertaintyJson: claim.uncertaintyJson,
      verification,
      decisionEligible,
    },
  });
  if (claim.evidence.length > 0) {
    await tx.marketClaimEvidence.createMany({
      data: claim.evidence.map((evidence) => ({
        claimId: next.id,
        observationId: evidence.observationId,
        role: evidence.role,
      })),
    });
  }
  return next;
}

function latestClaimVersions(rows) {
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.claimKey)) latest.set(row.claimKey, row);
  }
  return [...latest.values()];
}

function deniedProjectionState(cohort) {
  if (cohort.some((claim) => claim.verification === 'CONTRADICTED')) {
    return { dataStatus: 'DISPUTED', verification: 'CONTRADICTED' };
  }
  return { dataStatus: 'STALE', verification: 'STALE' };
}

async function verifyOfficialMarketSnapshotTransaction(prisma, {
  tenant = 'orderweeddc.com',
  asOf,
  acquisitionEventId = null,
}) {
  tenant = tenantKey(tenant);
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) throw new Error('CANA_REALITY_VERIFICATION_CLOCK_INVALID');
  return prisma.$transaction(async (tx) => {
    let acquisition = null;
    let acquisitionCourt = null;
    let liveLoaded = null;
    if (acquisitionEventId) {
      acquisition = await tx.marketSourceAcquisitionEvent.findUnique({
        where: { id: acquisitionEventId },
        include: { contentArtifact: true, snapshot: true },
      });
      acquisitionCourt = assertAdmittedAcquisition(acquisition, {
        tenant,
        purpose: 'REVALIDATE',
        asOf: clock,
      });
      const revocation = await tx.marketEvidenceRevocationEvent.findFirst({
        where: {
          effectiveAt: { lte: clock },
          decision: { in: ['EVIDENCE_QUARANTINED', 'EVIDENCE_REVOKED'] },
          OR: [
            { acquisitionEventId: acquisition.id },
            { contentArtifactId: acquisition.contentArtifactId },
            { snapshotId: acquisition.snapshotId },
            { parserVersion: acquisition.parserVersion },
            { targetKind: 'SOURCE_ACQUISITION', targetId: acquisition.id },
            { targetKind: 'CONTENT_ARTIFACT', targetId: acquisition.contentArtifactId },
            { targetKind: 'SNAPSHOT', targetId: acquisition.snapshotId },
            { targetKind: 'PARSER_VERSION', targetId: acquisition.parserVersion },
          ],
        },
        select: { id: true },
      });
      if (revocation) throw new Error('CANA_REALITY_EVIDENCE_REVOKED');
      liveLoaded = liveLoadedSnapshot(acquisition);
    }
    const compilation = await tx.marketCompilation.findFirst({
      where: acquisition
        ? { tenant, contentArtifactId: acquisition.contentArtifactId }
        : { tenant, snapshot: { is: { sourceKey: DC_ABCA_SOURCE.source_id } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { snapshot: true },
    });
    if (!compilation) throw new Error('CANA_REALITY_SNAPSHOT_NOT_COMPILED');
    const snapshot = compilation.snapshot;
    const rows = await tx.marketClaim.findMany({
      where: { tenant, compilationId: compilation.id },
      include: {
        resolution: true,
        evidence: { include: { observation: true } },
      },
      orderBy: [{ claimKey: 'asc' }, { version: 'desc' }],
      take: MAX_RELEVANT_CLAIM_HISTORY + 1,
    });
    if (rows.length > MAX_RELEVANT_CLAIM_HISTORY) {
      throw new Error('CANA_REALITY_CLAIM_HISTORY_BUDGET_EXCEEDED');
    }
    const claims = latestClaimVersions(rows);
    const identityContext = await loadCourtIdentityContext(tx, claims);
    const adjudicated = [];
    const pendingClaimStates = [];
    const pendingClaimEvidence = [];
    const pendingVerificationEvents = [];
    let admitted = 0;
    let denied = 0;
    const liveRecordByLicense = new Map((liveLoaded?.records ?? []).map((record) => [
      String(record.ABCA_NUMBER ?? '').normalize('NFKC').trim().toUpperCase(),
      record,
    ]));
    const currentEvidenceSnapshot = liveLoaded ? runtimeSnapshot(liveLoaded) : null;
    for (const claim of claims) {
      let effective = claim;
      let effectiveDecision;
      if (acquisition) {
        const evidenceSnapshot = runtimeSnapshot({
          ...liveLoaded,
          observation_time: claim.observedAt.toISOString(),
        });
        const originalDecision = adjudicateMarketClaim({
          ...courtInput(claim, snapshot, evidenceSnapshot),
          sourcePolicy: DC_ABCA_SOURCE,
          identityContext,
          asOf: claim.observedAt,
        });
        if (acquisitionCourt.zero_change && originalDecision.decision === 'ALLOW') {
          const record = liveRecordByLicense.get(claim.resolution.sourceRecordId);
          const licenseExpiration = typeof record?.EXPIRATION_DATE === 'number'
            ? new Date(record.EXPIRATION_DATE).toISOString()
            : null;
          const reattested = adjudicateZeroChangeReattestation({
            acquisition: acquisitionCourt,
            predicate: claim.claimType,
            sourcePolicy: DC_ABCA_SOURCE,
            licenseExpiration,
            asOf: clock,
          });
          effectiveDecision = {
            ...originalDecision,
            ...reattested,
            evidence_digest: canonicalDigest({
              schema_version: 'cana-zero-change-court-evidence/v1',
              claim_id: claim.id,
              acquisition_event_id: acquisition.id,
              content_sha256: acquisitionCourt.content_sha256,
              predicate: claim.claimType,
              value: claim.claimValue,
              freshness_expires_at: reattested.freshness_expires_at,
              decision: reattested.decision,
              reason: reattested.reason,
            }),
          };
        } else if (acquisitionCourt.zero_change) {
          effectiveDecision = originalDecision;
        } else {
          effectiveDecision = adjudicateMarketClaim({
            ...courtInput(claim, snapshot, currentEvidenceSnapshot),
            sourcePolicy: DC_ABCA_SOURCE,
            identityContext,
            asOf: clock,
          });
        }
        const verification = effectiveDecision.decision_eligible ? 'VERIFIED' : effectiveDecision.verification;
        effective = {
          ...claim,
          verification,
          decisionEligible: effectiveDecision.decision_eligible === true,
          freshnessExpiresAt: effectiveDecision.freshness_expires_at
            ? new Date(effectiveDecision.freshness_expires_at)
            : claim.freshnessExpiresAt,
        };
      } else {
        const input = courtInput(claim, snapshot);
        const decision = adjudicateMarketClaim({ ...input, sourcePolicy: DC_ABCA_SOURCE, identityContext, asOf: clock });
        const verification = decision.decision_eligible ? 'VERIFIED' : decision.verification;
        const decisionEligible = decision.decision_eligible === true;
        effectiveDecision = decision;
        if (claim.verification !== verification || claim.decisionEligible !== decisionEligible) {
          const next = {
            id: randomUUID(),
            tenant: claim.tenant,
            claimKey: claim.claimKey,
            claimType: claim.claimType,
            claimValue: claim.claimValue,
            version: claim.version + 1,
            resolutionId: claim.resolutionId,
            snapshotId: claim.snapshotId,
            compilationId: claim.compilationId,
            supersedesClaimId: claim.id,
            observedAt: claim.observedAt,
            freshnessExpiresAt: claim.freshnessExpiresAt,
            confidence: claim.confidence,
            uncertaintyJson: claim.uncertaintyJson,
            verification,
            decisionEligible,
          };
          pendingClaimStates.push(next);
          pendingClaimEvidence.push(...claim.evidence.map((evidence) => ({
            claimId: next.id,
            observationId: evidence.observationId,
            role: evidence.role,
          })));
          effective = { ...next, resolution: claim.resolution, evidence: claim.evidence };
          effectiveDecision = adjudicateMarketClaim({
            ...courtInput(effective, snapshot),
            sourcePolicy: DC_ABCA_SOURCE,
            identityContext,
            asOf: clock,
          });
        }
      }
      pendingVerificationEvents.push({
        claimId: effective.id,
        decision: effectiveDecision.decision,
        reason: effectiveDecision.reason,
        evaluatorVersion: MARKET_CLAIM_COURT_VERSION,
        evidenceDigest: effectiveDecision.evidence_digest,
        asOf: clock,
        acquisitionEventId: acquisition?.id ?? null,
        freshnessExpiresAt: effective.freshnessExpiresAt,
      });
      adjudicated.push(effective);
      if (effective.decisionEligible) admitted += 1;
      else denied += 1;
    }
    if (pendingClaimStates.length > 0) await tx.marketClaim.createMany({ data: pendingClaimStates });
    if (pendingClaimEvidence.length > 0) await tx.marketClaimEvidence.createMany({ data: pendingClaimEvidence });
    const eventClaimIds = pendingVerificationEvents.map((event) => event.claimId);
    const eventDigests = pendingVerificationEvents.map((event) => event.evidenceDigest);
    const existingEvents = eventClaimIds.length === 0 ? [] : await tx.marketVerificationEvent.findMany({
      where: {
        claimId: { in: eventClaimIds },
        evidenceDigest: { in: eventDigests },
        acquisitionEventId: acquisition?.id ?? null,
      },
      select: { claimId: true, evidenceDigest: true },
      take: MAX_RELEVANT_CLAIM_HISTORY + 1,
    });
    if (existingEvents.length > MAX_RELEVANT_CLAIM_HISTORY) {
      throw new Error('CANA_REALITY_VERIFICATION_EVENT_BUDGET_EXCEEDED');
    }
    const existingEventKeys = new Set(existingEvents.map((event) => `${event.claimId}:${event.evidenceDigest}`));
    const missingEvents = pendingVerificationEvents.filter((event) => (
      !existingEventKeys.has(`${event.claimId}:${event.evidenceDigest}`)
    ));
    const createdEvents = missingEvents.length === 0
      ? { count: 0 }
      : await tx.marketVerificationEvent.createMany({ data: missingEvents, skipDuplicates: true });
    const eventsCreated = createdEvents.count;

    const byResolution = new Map();
    for (const claim of adjudicated) {
      const cohort = byResolution.get(claim.resolutionId) ?? [];
      cohort.push(claim);
      byResolution.set(claim.resolutionId, cohort);
    }
    let publicCohorts = 0;
    if (tenant === PUBLIC_REALITY_PROJECTION_TENANT) {
      for (const cohort of byResolution.values()) {
        const byType = new Map(cohort.map((claim) => [claim.claimType, claim]));
        const required = ['license_number', 'license_status', 'regulated_address', 'operating_status'];
        const resolution = cohort[0].resolution;
        if (!resolution.retailerId || !resolution.geoEntityId) continue;
        const fullyEligible = required.every((type) => {
          const claim = byType.get(type);
          return claim?.decisionEligible === true && claim.verification === 'VERIFIED';
        });
        const active = fullyEligible
          && byType.get('license_status').claimValue === 'ACTIVE'
          && byType.get('operating_status').claimValue === 'ACTIVE';
        if (!active) {
          const state = deniedProjectionState(cohort);
          await tx.retailer.updateMany({
            where: {
              id: resolution.retailerId,
              dataSource: DC_ABCA_SOURCE.source_id,
            },
            data: { dataStatus: state.dataStatus },
          });
          await tx.geoClaim.updateMany({
            where: {
              geoEntityId: resolution.geoEntityId,
              projectionTenant: tenant,
              decisionEligible: true,
            },
            data: { verification: state.verification, decisionEligible: false },
          });
          continue;
        }
        const freshness = new Date(Math.min(...required.map((type) => byType.get(type).freshnessExpiresAt.getTime())));
        await tx.retailer.update({
          where: { id: resolution.retailerId },
          data: {
            address: byType.get('regulated_address').claimValue,
            licenseNumber: byType.get('license_number').claimValue,
            licenseStatus: 'VERIFIED',
            lastLicenseCheck: clock,
            dataStatus: 'VERIFIED_CURRENT',
            dataSource: DC_ABCA_SOURCE.source_id,
            sourceUrl: DC_ABCA_SOURCE.source_url,
            retrievedAt: acquisition?.fetchedAt ?? snapshot.fetchedAt,
            verifiedAt: clock,
            freshnessExpiresAt: freshness,
            confidence: 1,
            reviewedBy: MARKET_CLAIM_COURT_VERSION,
            isDemonstration: false,
          },
        });
        const operating = byType.get('operating_status');
        await tx.geoClaim.updateMany({
          where: {
            geoEntityId: resolution.geoEntityId,
            projectionTenant: tenant,
            decisionEligible: true,
            marketClaimId: { not: operating.id },
          },
          data: { verification: 'STALE', decisionEligible: false },
        });
        await tx.geoClaim.upsert({
          where: { marketClaimId: operating.id },
          update: {
            claimValue: operating.claimValue,
            observedAt: acquisition?.fetchedAt ?? operating.observedAt,
            freshnessExpiresAt: operating.freshnessExpiresAt,
            confidence: operating.confidence,
            verification: 'VERIFIED',
            decisionEligible: true,
            projectionTenant: tenant,
          },
          create: {
            geoEntityId: resolution.geoEntityId,
            claimType: 'operating_status',
            claimValue: operating.claimValue,
            source: DC_ABCA_SOURCE.source_id,
            sourceUrl: DC_ABCA_SOURCE.source_url,
            observedAt: acquisition?.fetchedAt ?? operating.observedAt,
            freshnessExpiresAt: operating.freshnessExpiresAt,
            confidence: operating.confidence,
            verification: 'VERIFIED',
            decisionEligible: true,
            marketClaimId: operating.id,
            projectionTenant: tenant,
          },
        });
        publicCohorts += 1;
      }
    }
    let revalidationMissionsCreated = 0;
    let revalidationMissionsReused = 0;
    if (acquisition) {
      const debt = computeFreshnessDebt({
        tenant,
        asOf: clock,
        claims: adjudicated
          .filter((claim) => DC_ABCA_SOURCE.authoritative_predicates.includes(claim.claimType))
          .map((claim) => ({
            id: claim.id,
            predicate: claim.claimType,
            freshness_expires_at: claim.freshnessExpiresAt,
            decision_eligible: claim.decisionEligible,
            demand_count: 0,
            dependent_decisions: claim.resolution.retailerId ? 1 : 0,
            source_available: true,
            estimated_acquisition_cost_cents: 0,
          })),
      });
      for (const item of debt.items.filter((entry) => entry.requires_revalidation)) {
        const scheduled = await scheduleFreshnessRevalidation(tx, item, { now: clock });
        if (scheduled.state === 'CREATED') revalidationMissionsCreated += 1;
        else revalidationMissionsReused += 1;
      }
    }
    return Object.freeze({
      state: 'VERIFIED',
      evaluated_claims: claims.length,
      admitted_claims: admitted,
      denied_claims: denied,
      verification_events_created: eventsCreated,
      acquisition_event_id: acquisition?.id ?? null,
      content_artifact_id: acquisition?.contentArtifactId ?? null,
      revalidation_missions_created: revalidationMissionsCreated,
      revalidation_missions_reused: revalidationMissionsReused,
      public_cohorts: publicCohorts,
      projection_state: tenant === PUBLIC_REALITY_PROJECTION_TENANT ? 'PUBLIC_POLICY_AUTHORIZED' : 'TENANT_SCOPED_ONLY',
      court_version: MARKET_CLAIM_COURT_VERSION,
      as_of: clock.toISOString(),
    });
  }, { isolationLevel: 'Serializable', timeout: 60_000 });
}

export async function verifyOfficialMarketSnapshot(prisma, options) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await verifyOfficialMarketSnapshotTransaction(prisma, options); } catch (error) {
      if (!retryableTransaction(error) || attempt === 2) throw error;
    }
  }
  throw new Error('CANA_REALITY_VERIFICATION_RETRY_EXHAUSTED');
}

export async function verifyLiveMarketAcquisition(prisma, {
  tenant,
  acquisitionEventId,
  asOf,
}) {
  if (typeof acquisitionEventId !== 'string' || acquisitionEventId.length === 0) {
    throw new Error('CANA_REALITY_ACQUISITION_EVENT_REQUIRED');
  }
  return verifyOfficialMarketSnapshot(prisma, { tenant, acquisitionEventId, asOf });
}

export async function revokeMarketEvidence(prisma, {
  tenant,
  targetKind,
  targetId,
  cause,
  actorKind = 'OWNER',
  effectiveAt,
  decision = 'EVIDENCE_REVOKED',
}) {
  tenant = tenantKey(tenant);
  if (!['SOURCE_ACQUISITION', 'CONTENT_ARTIFACT', 'SNAPSHOT', 'OBSERVATION', 'PARSER_VERSION', 'POLICY_VERSION'].includes(targetKind)
    || typeof targetId !== 'string' || targetId.length === 0
    || typeof cause !== 'string' || cause.length === 0 || cause.length > 2_000
    || typeof actorKind !== 'string' || actorKind.length === 0 || actorKind.length > 80
    || !['EVIDENCE_QUARANTINED', 'EVIDENCE_REVOKED'].includes(decision)) {
    throw new Error('CANA_REALITY_REVOCATION_INPUT_INVALID');
  }
  const clock = effectiveAt instanceof Date ? effectiveAt : new Date(effectiveAt);
  if (!Number.isFinite(clock.getTime())) throw new Error('CANA_REALITY_REVOCATION_TIME_INVALID');
  return prisma.$transaction(async (tx) => {
    const acquisitionIds = [];
    const snapshotIds = [];
    const observationIds = [];
    let contentArtifactId = null;
    let acquisitionEventId = null;
    let snapshotId = null;
    let parserVersion = null;
    let policyVersion = null;
    if (targetKind === 'SOURCE_ACQUISITION') {
      const acquisition = await tx.marketSourceAcquisitionEvent.findUnique({ where: { id: targetId } });
      if (!acquisition || acquisition.tenant !== tenant) throw new Error('CANA_REALITY_REVOCATION_TARGET_NOT_FOUND');
      acquisitionIds.push(acquisition.id);
      if (acquisition.snapshotId) snapshotIds.push(acquisition.snapshotId);
      contentArtifactId = acquisition.contentArtifactId;
      acquisitionEventId = acquisition.id;
      snapshotId = acquisition.snapshotId;
    } else if (targetKind === 'CONTENT_ARTIFACT') {
      const artifact = await tx.marketSourceContentArtifact.findUnique({ where: { id: targetId } });
      if (!artifact) throw new Error('CANA_REALITY_REVOCATION_TARGET_NOT_FOUND');
      contentArtifactId = artifact.id;
      snapshotId = artifact.snapshotId;
      snapshotIds.push(artifact.snapshotId);
      const acquisitions = await tx.marketSourceAcquisitionEvent.findMany({
        where: { tenant, contentArtifactId: artifact.id },
        select: { id: true },
      });
      acquisitionIds.push(...acquisitions.map((entry) => entry.id));
    } else if (targetKind === 'SNAPSHOT') {
      const snapshot = await tx.marketSourceSnapshot.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!snapshot) throw new Error('CANA_REALITY_REVOCATION_TARGET_NOT_FOUND');
      snapshotId = snapshot.id;
      snapshotIds.push(snapshot.id);
    } else if (targetKind === 'OBSERVATION') {
      const observation = await tx.marketObservation.findUnique({ where: { id: targetId } });
      if (!observation) throw new Error('CANA_REALITY_REVOCATION_TARGET_NOT_FOUND');
      observationIds.push(observation.id);
      snapshotId = observation.snapshotId;
    } else if (targetKind === 'PARSER_VERSION') {
      parserVersion = targetId;
      const acquisitions = await tx.marketSourceAcquisitionEvent.findMany({
        where: { tenant, parserVersion: targetId },
        select: { id: true, snapshotId: true },
      });
      acquisitionIds.push(...acquisitions.map((entry) => entry.id));
      snapshotIds.push(...acquisitions.map((entry) => entry.snapshotId).filter(Boolean));
    } else {
      policyVersion = targetId;
      const acquisitions = await tx.marketSourceAcquisitionEvent.findMany({
        where: {
          tenant,
          OR: [{ authorityPolicyVersion: targetId }, { freshnessPolicyVersion: targetId }],
        },
        select: { id: true, snapshotId: true },
      });
      acquisitionIds.push(...acquisitions.map((entry) => entry.id));
      snapshotIds.push(...acquisitions.map((entry) => entry.snapshotId).filter(Boolean));
    }
    const prior = await tx.marketEvidenceRevocationEvent.findFirst({
      where: { tenant, targetKind, targetId },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { eventHash: true },
    });
    const priorEventHash = prior?.eventHash ?? '0'.repeat(64);
    const eventHash = canonicalDigest({
      schema_version: 'cana-market-evidence-revocation/v1',
      tenant,
      target_kind: targetKind,
      target_id: targetId,
      decision,
      cause,
      actor_kind: actorKind,
      effective_at: clock.toISOString(),
      prior_event_hash: priorEventHash,
    });
    const existing = await tx.marketEvidenceRevocationEvent.findUnique({ where: { eventHash } });
    if (existing) return Object.freeze({ state: 'NOOP', revocation_event_id: existing.id });
    const revocation = await tx.marketEvidenceRevocationEvent.create({ data: {
      tenant,
      targetKind,
      targetId,
      decision,
      cause,
      actorKind,
      effectiveAt: clock,
      contentArtifactId,
      acquisitionEventId,
      snapshotId,
      observationId: targetKind === 'OBSERVATION' ? targetId : null,
      parserVersion,
      policyVersion,
      priorEventHash,
      eventHash,
    } });
    const affectedRows = await tx.marketClaim.findMany({
      where: {
        tenant,
        OR: [
          ...(snapshotIds.length ? [{ snapshotId: { in: [...new Set(snapshotIds)] } }] : []),
          ...(observationIds.length ? [{ evidence: { some: { observationId: { in: observationIds } } } }] : []),
          ...(acquisitionIds.length ? [
            { compilation: { acquisitionEventId: { in: [...new Set(acquisitionIds)] } } },
            { verificationEvents: { some: { acquisitionEventId: { in: [...new Set(acquisitionIds)] } } } },
          ] : []),
        ],
      },
      include: { resolution: true, evidence: true },
      orderBy: [{ claimKey: 'asc' }, { version: 'desc' }],
    });
    const affected = latestClaimVersions(affectedRows);
    const affectedClaimIds = [];
    const affectedRetailerIds = new Set();
    for (const claim of affected) {
      const next = await appendClaimState(tx, claim, { verification: 'REFUTED', decisionEligible: false });
      affectedClaimIds.push(claim.id, next.id);
      if (claim.resolution.retailerId) affectedRetailerIds.add(claim.resolution.retailerId);
      const evidenceDigest = canonicalDigest({
        schema_version: 'cana-revocation-court-evidence/v1',
        claim_id: next.id,
        revocation_event_id: revocation.id,
        decision: 'DENY',
        reason: 'EVIDENCE_REVOKED_REQUIRES_RECONSIDERATION',
      });
      await tx.marketVerificationEvent.create({ data: {
        claimId: next.id,
        evidenceRevocationId: revocation.id,
        decision: 'DENY',
        reason: 'EVIDENCE_REVOKED_REQUIRES_RECONSIDERATION',
        evaluatorVersion: MARKET_CLAIM_COURT_VERSION,
        evidenceDigest,
        asOf: clock,
        freshnessExpiresAt: clock,
      } });
    }
    if (affectedClaimIds.length > 0) {
      await tx.geoClaim.updateMany({
        where: { marketClaimId: { in: affectedClaimIds }, decisionEligible: true },
        data: { verification: 'REFUTED', decisionEligible: false },
      });
    }
    if (affectedRetailerIds.size > 0) {
      await tx.retailer.updateMany({
        where: { id: { in: [...affectedRetailerIds] }, dataSource: DC_ABCA_SOURCE.source_id },
        data: { dataStatus: 'STALE' },
      });
    }
    return Object.freeze({
      state: 'REVOKED',
      revocation_event_id: revocation.id,
      affected_claims: affected.length,
      affected_retailers: affectedRetailerIds.size,
      replacement_truth_created: 0,
      history_deleted: 0,
    });
  }, { isolationLevel: 'Serializable', timeout: 60_000 });
}
