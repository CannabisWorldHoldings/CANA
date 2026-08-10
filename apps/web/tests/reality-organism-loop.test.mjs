import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { GENESIS_HASH, receiptHash } from '../src/lib/continuation/continuation-core.mjs';

let reality;
let marketGap;

before(async () => {
  try {
    reality = await import('../src/lib/reality/reality-compiler.mjs');
    marketGap = await import('../src/lib/ask/market-gap-recheck.mjs');
  } catch (error) {
    assert.fail(`Reality organism loop is not implemented: ${error.message}`);
  }
});

async function marketGapHarness({
  tenant = 'orderweeddc.com',
  tickId = 'tick-1',
  triggerStatus = 'FIRED',
  opportunityTriggerId = 'trigger-1',
  tamperReceipt = false,
} = {}) {
  const now = new Date('2026-08-10T04:00:00.000Z');
  const updates = [];
  const evidenceRequirements = JSON.stringify({
    consumer: 'ask_market_gap_recheck',
    recheck: 'verified_candidate_count',
    opportunityId: 'gap-1',
  });
  const mission = {
    id: 'mission-1', tenant: 'orderweeddc.com', status: 'ACTIVE',
    latestReceiptId: 'receipt-fired-1',
  };
  const trigger = {
    id: 'trigger-1', missionId: mission.id, tenant: mission.tenant,
    status: triggerStatus, authorityCeiling: 'OBSERVE_ONLY',
    evidenceRequirements, createdFrom: 'OPPORTUNITY:gap-1',
  };
  const firedBody = {
    seq: 1,
    missionId: mission.id,
    triggerId: trigger.id,
    tickId: 'tick-1',
    action: 'FIRED',
    detail: 'follow-up due',
    evidence: JSON.stringify({
      triggerType: 'FOLLOW_UP',
      reason: 'recheck',
      authorityCeiling: 'OBSERVE_ONLY',
      tenantId: mission.tenant,
      evidenceRequirements,
      firedAt: now.toISOString(),
    }),
  };
  const firedReceipt = {
    id: 'receipt-fired-1',
    ...firedBody,
    prevHash: GENESIS_HASH,
    entryHash: await receiptHash(firedBody, GENESIS_HASH),
    recordedAt: now,
  };
  if (tamperReceipt) firedReceipt.detail = 'tampered after hashing';
  const receipts = [firedReceipt];
  const retailer = {
    id: 'r-1', name: 'Verified', type: 'storefront', address: 'Dupont Circle', city: 'Washington', state: 'DC', zip: '20001',
    lat: 38.91, lng: -77.04, phone: null, website: null, hours: 'UNKNOWN', hoursSource: 'Unspecified',
    licenseStatus: 'VERIFIED', dataStatus: 'VERIFIED_CURRENT', dataSource: 'DC ABCA', sourceUrl: 'https://dc.gov',
    retrievedAt: now, verifiedAt: new Date(now.getTime() - 1_000), freshnessExpiresAt: new Date(now.getTime() + 86_400_000),
    confidence: 1, isDemonstration: false,
  };
  const opportunity = {
    id: 'gap-1', tenant: 'orderweeddc.com', kind: 'MARKET_GAP', status: 'OPEN',
    followUpTriggerId: opportunityTriggerId,
    evidence: JSON.stringify({ intent_ir: {
      raw_query: 'sha256:minimized', unknown_dimensions: [], unsupported_known_dimensions: [],
      dimensions: { location: { status: 'KNOWN', value: 'Dupont Circle' } },
    } }),
  };
  const tx = {
    opportunity: {
      findFirst: async ({ where }) => where.id === opportunity.id && where.tenant === opportunity.tenant ? opportunity : null,
      updateMany: async (args) => {
        updates.push(['opportunity', args]);
        if (args.where.id !== opportunity.id || args.where.tenant !== opportunity.tenant || opportunity.status !== 'OPEN') return { count: 0 };
        opportunity.status = args.data.status;
        return { count: 1 };
      },
    },
    continuationMission: {
      findUnique: async ({ where }) => where.id === mission.id ? mission : null,
      updateMany: async (args) => { updates.push(['mission-many', args]); return { count: 1 }; },
      update: async (args) => { updates.push(['mission', args]); mission.latestReceiptId = args.data.latestReceiptId; return mission; },
    },
    continuationTrigger: {
      findUnique: async ({ where }) => where.id === trigger.id ? trigger : null,
      updateMany: async (args) => { updates.push(['trigger-many', args]); return { count: 1 }; },
      update: async (args) => { updates.push(['trigger', args]); trigger.latestReceiptId = args.data.latestReceiptId; return trigger; },
    },
    continuationReceipt: {
      findUnique: async ({ where }) => receipts.find((entry) => entry.id === where.id) ?? null,
      findMany: async ({ where }) => receipts.filter((entry) => entry.missionId === where.missionId).sort((a, b) => a.seq - b.seq),
      findFirst: async ({ where, orderBy }) => {
        const matches = receipts.filter((entry) => (
          (!where.missionId || entry.missionId === where.missionId)
          && (!where.triggerId || entry.triggerId === where.triggerId)
          && (!where.tickId || entry.tickId === where.tickId)
          && (!where.action || entry.action === where.action)
        ));
        return orderBy?.seq === 'desc' ? matches.sort((a, b) => b.seq - a.seq)[0] ?? null : matches[0] ?? null;
      },
      create: async ({ data }) => {
        const receipt = { id: `receipt-${receipts.length + 1}`, ...data, recordedAt: now };
        receipts.push(receipt);
        return receipt;
      },
    },
    brand: { findUnique: async () => ({ id: 'brand-1' }) },
    retailer: { findMany: async () => [retailer] },
  };
  const result = await marketGap.recheckMarketGap(tx, {
    tenant,
    receiptId: firedReceipt.id,
    tickId,
    now,
  });
  return { result, updates, receipts, opportunity };
}

test('registered MARKET_GAP consumer closes tenant-scoped work only from a durable FIRED receipt', async () => {
  const { result, updates } = await marketGapHarness();
  assert.equal(result.state, 'CLOSED');
  assert.equal(result.verified_candidate_count, 1);
  assert.equal(updates.some(([kind, args]) => kind === 'opportunity' && args.data.status === 'CLOSED'), true);
  assert.equal(updates.some(([kind, args]) => kind === 'mission-many' && args.where.tenant === 'orderweeddc.com'), true);
});

test('forged, cross-tenant, wrong-tick, non-fired, tampered, and mismatched continuation authority fails closed', async () => {
  for (const [label, options, reason] of [
    ['cross tenant', { tenant: 'other.example' }, 'TENANT_OR_IDENTITY_MISMATCH'],
    ['wrong tick', { tickId: 'tick-forged' }, 'TICK_MISMATCH'],
    ['armed trigger', { triggerStatus: 'ARMED' }, 'TRIGGER_NOT_FIRED'],
    ['tampered receipt', { tamperReceipt: true }, 'RECEIPT_CHAIN_INVALID'],
    ['wrong opportunity binding', { opportunityTriggerId: 'other-trigger' }, 'OPPORTUNITY_TRIGGER_BINDING_MISMATCH'],
  ]) {
    const { result, updates, opportunity } = await marketGapHarness(options);
    assert.equal(result.state, 'REFUSED', label);
    assert.equal(result.reason, reason, label);
    assert.equal(opportunity.status, 'OPEN', label);
    assert.equal(updates.some(([kind]) => kind === 'opportunity'), false, label);
  }
});

test('ASK gap closes only after governed evidence improves public answerability', () => {
  const receipt = reality.runOrganismLoopScenario({
    tenant: 'orderweeddc.com',
    intent: {
      raw_query: 'licensed retailer near Dupont Circle',
      required_predicates: ['license_status', 'regulated_address'],
    },
    demandSignals: 3,
    verifiedClaimsBefore: [],
    verifiedClaimsAfter: [
      { subject_ref: 'retailer-1', predicate: 'license_status', value: 'ACTIVE', decision_eligible: true },
      { subject_ref: 'retailer-1', predicate: 'regulated_address', value: '100 Truth Ave NW', decision_eligible: true },
    ],
  });

  assert.equal(receipt.before.answerable, false);
  assert.deepEqual(receipt.before.blocking_predicates, ['license_status', 'regulated_address']);
  assert.equal(receipt.verification_opportunities, 1);
  assert.equal(receipt.continuation_missions, 1);
  assert.equal(receipt.after.answerable, true);
  assert.equal(receipt.gap_closed, true);
  assert.ok(receipt.site_intelligence_coverage_delta > 0);
  assert.deepEqual(receipt.effects, {
    network_live_source_calls: 0,
    provider_calls: 0,
    paid_calls: 0,
    spend_cents: 0,
    production_mutations: 0,
    deployments: 0,
    cognitive_promotions: 0,
  });
});

test('repeated demand deduplicates work and unknown evidence cannot close the gap', () => {
  const receipt = reality.runOrganismLoopScenario({
    tenant: 'orderweeddc.com',
    intent: {
      raw_query: 'who delivers to Navy Yard tonight',
      required_predicates: ['delivery', 'service_area', 'hours'],
    },
    demandSignals: 9,
    verifiedClaimsBefore: [],
    verifiedClaimsAfter: [
      { subject_ref: 'retailer-1', predicate: 'delivery', value: true, decision_eligible: false },
    ],
  });

  assert.equal(receipt.verification_opportunities, 1);
  assert.equal(receipt.continuation_missions, 1);
  assert.equal(receipt.after.answerable, false);
  assert.equal(receipt.gap_closed, false);
});
