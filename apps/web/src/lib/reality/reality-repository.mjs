import { MARKET_CLAIM_COURT_VERSION, adjudicateMarketClaim } from './market-claim-court.mjs';
import { normalizeCoordinates } from './entity-resolution.mjs';
import { loadOfficialSourceSnapshot } from './official-source-snapshot.mjs';
import {
  DC_ABCA_SOURCE,
  createEvidenceSnapshot,
  compileRealitySnapshot,
  contradictoryObservationIds,
  parseAbcaSnapshot,
} from './reality-compiler.mjs';

export const PUBLIC_REALITY_PROJECTION_TENANT = 'orderweeddc.com';

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
  return loaded.source_modified_at ?? `${loaded.source_catalog_modified_date}T00:00:00.000Z`;
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
}) {
  tenant = tenantKey(tenant);
  const loaded = loadOfficialSourceSnapshot(snapshotDirectory);
  const snapshot = runtimeSnapshot(loaded);
  const parsed = parseAbcaSnapshot(snapshot);
  return prisma.$transaction(async (tx) => {
    let snapshotRow = await tx.marketSourceSnapshot.findUnique({
      where: { sourceKey_payloadSha256: { sourceKey: loaded.source_id, payloadSha256: snapshot.sha256 } },
    });
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
    const compilation = await tx.marketCompilation.create({ data: { tenant, snapshotId: snapshotRow.id } });

    const retailers = await tx.retailer.findMany({
      where: { licenseNumber: { not: null } },
      select: { id: true, licenseNumber: true, name: true },
    });
    const geoEntities = await tx.geoEntity.findMany({
      where: { retailerId: { in: retailers.map((retailer) => retailer.id) } },
      select: { id: true, retailerId: true },
    });
    const geoByRetailer = new Map(geoEntities.map((entity) => [entity.retailerId, entity.id]));
    for (const retailer of retailers) retailer.geoEntityId = geoByRetailer.get(retailer.id) ?? null;
    const aliasRows = await tx.geoEntityAlias.findMany({
      where: { namespace: 'dc_abca_license' },
      select: { id: true, namespace: true, externalId: true, geoEntityId: true },
    });
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
    const observationRows = new Map();
    for (const item of compiled.observations) {
      let row = await tx.marketObservation.findUnique({
        where: { snapshotId_sourceRecordId_fieldName: { snapshotId: snapshotRow.id, sourceRecordId: item.source_record_key, fieldName: item.predicate } },
      });
      if (!row) {
        row = await tx.marketObservation.create({ data: {
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
        } });
      }
      observationRows.set(item.observation_id, row.id);
    }

    const resolutionRows = new Map();
    for (const item of compiled.resolutions) {
      const record = parsed.records.find((entry) => entry.record_hash === item.source_record_sha256);
      const retailer = retailers.find((entry) => entry.id === item.retailer_id);
      const row = await tx.marketEntityResolution.create({ data: {
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
        } });
      resolutionRows.set(record.normalized_license, row.id);
    }

    let claims = 0;
    let contradictions = 0;
    for (const item of compiled.claims) {
      const claimKey = `${item.subject_id}:${item.predicate}`;
      const priorClaims = await tx.marketClaim.findMany({
        where: { tenant, claimKey },
        orderBy: { version: 'desc' },
        include: { evidence: true },
      });
      const prior = priorClaims[0] ?? null;
      const conflictingObservationIds = contradictoryObservationIds(
        { claimKey, claimValue: serialized(item.value) },
        priorClaims.map((entry) => ({
          claimKey: entry.claimKey,
          claimValue: entry.claimValue,
          observationIds: entry.evidence.filter((evidence) => evidence.role === 'SUPPORTS').map((evidence) => evidence.observationId),
        })),
      );
      const claim = await tx.marketClaim.create({
        data: {
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
        },
      });
      for (const observationId of item.observation_ids) {
        await tx.marketClaimEvidence.create({
          data: { claimId: claim.id, observationId: observationRows.get(observationId), role: 'SUPPORTS' },
        });
      }
      const conflictingPrior = priorClaims.find((entry) => entry.claimValue !== serialized(item.value));
      if (conflictingPrior && conflictingObservationIds.length > 0) {
        await tx.marketClaimContradiction.create({
          data: {
            tenant,
            claimKey,
            earlierClaimId: conflictingPrior.id,
            laterClaimId: claim.id,
            earlierObservationIdsJson: JSON.stringify(conflictingObservationIds),
            laterObservationIdsJson: JSON.stringify(item.observation_ids),
            state: 'ACTIVE',
          },
        });
        for (const observationId of conflictingObservationIds) {
          await tx.marketClaimEvidence.create({ data: { claimId: claim.id, observationId, role: 'CONTRADICTS' } });
        }
        contradictions += 1;
      }
      claims += 1;
    }
    return Object.freeze({
      state: 'COMPILED',
      snapshot_id: snapshotRow.id,
      source_records: loaded.record_count,
      observations: compiled.observations.length,
      resolutions: compiled.resolutions.length,
      claims,
      compilation_id: compilation.id,
      provisional_retailers: 0,
      contradictions,
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

function courtInput(claim, snapshot) {
  const supportingEvidence = claim.evidence.filter((entry) => entry.role === 'SUPPORTS');
  const evidence = supportingEvidence[0]?.observation;
  return {
    claim: {
      claim_id: claim.id,
      tenant: claim.tenant,
      subject_id: claim.resolution.retailerId ?? claim.resolution.geoEntityId,
      predicate: claim.claimType,
      value: claim.claimValue,
      source_id: snapshot.sourceKey,
      source_url: snapshot.sourceUrl,
      snapshot_sha256: snapshot.payloadSha256,
      source_record_key: claim.resolution.sourceRecordId,
      source_record_sha256: claim.resolution.sourceRecordSha256,
      observation_ids: supportingEvidence.map((entry) => entry.observationId),
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
    snapshot: createEvidenceSnapshot({
      sourceId: snapshot.sourceKey,
      payloadBytes: Buffer.from(snapshot.payloadJson),
      fetchedAt: claim.observedAt,
      completeness: snapshot.completeness,
    }),
  };
}

async function copyClaimEvidence(tx, sourceClaim, targetClaimId) {
  for (const evidence of sourceClaim.evidence) {
    await tx.marketClaimEvidence.create({
      data: { claimId: targetClaimId, observationId: evidence.observationId, role: evidence.role },
    });
  }
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
  await copyClaimEvidence(tx, claim, next.id);
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
}) {
  tenant = tenantKey(tenant);
  const clock = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(clock.getTime())) throw new Error('CANA_REALITY_VERIFICATION_CLOCK_INVALID');
  return prisma.$transaction(async (tx) => {
    const compilation = await tx.marketCompilation.findFirst({
      where: { tenant, snapshot: { is: { sourceKey: DC_ABCA_SOURCE.source_id } } },
      orderBy: [{ snapshot: { fetchedAt: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }],
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
    });
    const claims = latestClaimVersions(rows);
    const adjudicated = [];
    let admitted = 0;
    let denied = 0;
    let eventsCreated = 0;
    for (const claim of claims) {
      const input = courtInput(claim, snapshot);
      const decision = adjudicateMarketClaim({ ...input, sourcePolicy: DC_ABCA_SOURCE, asOf: clock });
      const verification = decision.decision_eligible ? 'VERIFIED' : decision.verification;
      const decisionEligible = decision.decision_eligible === true;
      let effective = claim;
      let effectiveDecision = decision;
      if (claim.verification !== verification || claim.decisionEligible !== decisionEligible) {
        const next = await appendClaimState(tx, claim, { verification, decisionEligible });
        effective = { ...next, resolution: claim.resolution, evidence: claim.evidence };
        effectiveDecision = adjudicateMarketClaim({
          ...courtInput(effective, snapshot),
          sourcePolicy: DC_ABCA_SOURCE,
          asOf: clock,
        });
      }
      const existingEvent = await tx.marketVerificationEvent.findFirst({
        where: { claimId: effective.id, evidenceDigest: effectiveDecision.evidence_digest },
        select: { id: true },
      });
      if (!existingEvent) {
        await tx.marketVerificationEvent.create({
          data: {
            claimId: effective.id,
            decision: effectiveDecision.decision,
            reason: effectiveDecision.reason,
            evaluatorVersion: MARKET_CLAIM_COURT_VERSION,
            evidenceDigest: effectiveDecision.evidence_digest,
            asOf: clock,
          },
        });
        eventsCreated += 1;
      }
      adjudicated.push(effective);
      if (decisionEligible) admitted += 1;
      else denied += 1;
    }

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
              reviewedBy: MARKET_CLAIM_COURT_VERSION,
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
            retrievedAt: snapshot.fetchedAt,
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
            observedAt: operating.observedAt,
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
            observedAt: operating.observedAt,
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
    return Object.freeze({
      state: 'VERIFIED',
      evaluated_claims: claims.length,
      admitted_claims: admitted,
      denied_claims: denied,
      verification_events_created: eventsCreated,
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
