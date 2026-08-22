import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

import {
  buildCustomerWorldView,
  marketPageRecordsFromCards,
  normalizeCustomerMerchantId,
  normalizeCustomerWorldRequest,
  resolveCustomerMerchant,
  resolveCustomerWorld,
} from '../src/lib/customer-world.mjs';
import {
  resolveCustomerMerchantProfile,
  resolveCustomerMerchantProfileFromReality,
} from '../src/lib/ask/customer-discovery.mjs';
import {
  CUSTOMER_DISCOVERY_MARKETS,
  resolveCustomerMarketContext,
} from '../src/lib/ask/customer-discovery-contract.mjs';
import { persistenceSafeIntent } from '../src/lib/ask/intent-ir.mjs';

const NOW = new Date('2026-08-13T08:30:00.000Z');
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDirectory, '..');
const serverBridgePath = path.join(webRoot, 'src/lib/customer-world.server.ts');
const producerPath = path.join(webRoot, 'src/lib/customer-world.mjs');
const customerDiscoveryPath = path.join(webRoot, 'src/lib/ask/customer-discovery.mjs');

async function loadServerBridge() {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-server-bridge-'));
  const fixtureServerPath = path.join(fixtureDirectory, 'customer-world.server.mjs');
  const prismaPath = path.join(fixtureDirectory, 'prisma.mjs');
  const customerWorldPath = path.join(fixtureDirectory, 'customer-world.mjs');
  const askWorkPath = path.join(fixtureDirectory, 'ask-work.mjs');
  const serverSource = fs.readFileSync(serverBridgePath, 'utf8')
    .replace("from '@/lib/prisma'", "from './prisma.mjs'")
    .replace("from '@/lib/customer-world.mjs'", "from './customer-world.mjs'")
    .replace("from '@/lib/ask/ask-work.mjs'", "from './ask-work.mjs'");
  const output = ts.transpileModule(serverSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: serverBridgePath,
  });
  fs.writeFileSync(fixtureServerPath, output.outputText);
  fs.writeFileSync(prismaPath, `
    const findMany = async () => [];
    export const prisma = {
      brand: { findUnique: async () => ({ name: 'ORDERWEEDDC' }) },
      marketClaim: { findMany },
      marketVerificationEvent: { findMany },
      marketSourceAcquisitionEvent: { findMany },
      marketSourceContentArtifact: { findMany },
      marketSourceSnapshot: { findMany },
      marketEvidenceRevocationEvent: { findMany },
    };
  `);
  fs.writeFileSync(customerWorldPath, `
    export { resolveCustomerMerchant, resolveCustomerWorld } from ${JSON.stringify(pathToFileURL(producerPath).href)};
  `);
  fs.writeFileSync(askWorkPath, `
    export const persisted = [];
    let persistenceAvailable = true;
    export function setPersistenceAvailable(value) { persistenceAvailable = value; }
    export async function recordAskWork(_client, input) {
      if (!persistenceAvailable) throw new Error('instrumentation unavailable');
      persisted.push(input);
      return { state: 'RECORDED' };
    }
  `);
  const askWork = await import(pathToFileURL(askWorkPath).href);
  const serverBridge = await import(pathToFileURL(fixtureServerPath).href);
  return {
    askWork,
    loadCustomerWorld: serverBridge.loadCustomerWorld,
    dispose: () => fs.rmSync(fixtureDirectory, { force: true, recursive: true }),
  };
}

function projectDiagnostics({ producerSource }) {
  const configPath = path.join(webRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, webRoot);
  const options = { ...parsed.options, incremental: false, noEmit: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => (
    path.resolve(fileName) === producerPath
      ? ts.createSourceFile(fileName, producerSource, languageVersion, true, ts.ScriptKind.JS)
      : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  );
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    fileName: diagnostic.file?.fileName ?? null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

function typeFixtureDiagnostics(source) {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-customer-discovery-type-'));
  const fixturePath = path.join(fixtureDirectory, 'dependency-signature.ts');
  fs.writeFileSync(fixturePath, source);
  try {
    const configPath = path.join(webRoot, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, webRoot);
    const program = ts.createProgram({
      rootNames: [...parsed.fileNames, fixturePath],
      options: { ...parsed.options, incremental: false, noEmit: true },
    });
    return ts.getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === fixturePath)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  } finally {
    fs.rmSync(fixtureDirectory, { force: true, recursive: true });
  }
}

function field(state, value = null, reason = null) {
  return { state, value, ...(reason ? { reason } : {}) };
}

function projection(overrides = {}) {
  const result = {
    merchant_id: 'merchant-md-1',
    customer_facing_name: field('KNOWN', 'Bethesda Wellness'),
    business_type: field('UNKNOWN', null, 'BUSINESS_TYPE_UNKNOWN'),
    regulatory_state: field('UNKNOWN', null, 'REGULATORY_STATE_UNKNOWN'),
    verification_state: field('KNOWN', 'VERIFIED_CURRENT'),
    location: {
      address: field('KNOWN', '1 Wisconsin Ave'),
      city: field('KNOWN', 'Bethesda'),
      region: field('KNOWN', 'MD'),
      postal_code: field('KNOWN', '20814'),
      coordinates: field('KNOWN', { latitude: 38.9847, longitude: -77.0947 }),
    },
    market: field('KNOWN', 'US-MD'),
    distance: field('UNKNOWN', null, 'CUSTOMER_COORDINATES_AND_ROUTE_DISTANCE_NOT_PROVEN'),
    fulfillment_type: field('UNKNOWN', null, 'FULFILLMENT_INTENT_UNKNOWN'),
    delivery_authority: field('UNKNOWN', null, 'NO_DECISION_ELIGIBLE_DELIVERY_AUTHORITY_CLAIM'),
    delivery_eligibility: field('UNKNOWN', null, 'CUSTOMER_LOCATION_AND_SERVICE_AREA_NOT_PROVEN'),
    price: field('UNKNOWN', null, 'PRICE_INTENT_UNKNOWN'),
    category: field('UNKNOWN', null, 'CATEGORY_INTENT_UNKNOWN'),
    open_now: field('UNKNOWN', null, 'OPEN_NOW_INTENT_UNKNOWN'),
    deal: field('UNKNOWN', null, 'NO_DECISION_ELIGIBLE_DEAL_EVIDENCE'),
    freshness: field('KNOWN', {
      retrieved_at: '2026-08-13T06:00:00.000Z',
      verified_at: '2026-08-13T06:05:00.000Z',
      freshness_expires_at: '2026-08-14T06:05:00.000Z',
    }),
    provenance: {
      source: 'Maryland Cannabis Administration',
      source_url: 'https://cannabis.maryland.gov/',
      data_status: 'VERIFIED_CURRENT',
      is_demonstration: false,
    },
    unknown_dimensions: [
      'distance', 'fulfillment_type', 'delivery_authority', 'delivery_eligibility',
      'price', 'category', 'open_now', 'deal',
    ],
    capability_gaps: [],
  };
  return {
    schema_version: 'cana-customer-discovery-projection/v1',
    generated_at: NOW.toISOString(),
    market: {
      state: 'KNOWN', market_id: 'US-MD', jurisdiction_code: 'MD',
      evidence: {
        source_key: 'md-mca-dispensaries', source_id: 'Maryland Cannabis Administration',
        source_url: 'https://cannabis.maryland.gov/', contract_digest: 'digest-md',
      },
    },
    intent: {
      ir_version: 1, compiler: 'deterministic',
      dimensions: { location: { status: 'KNOWN', value: 'bethesda' } },
      unknown_dimensions: ['category', 'price_max_usd', 'fulfillment', 'open_now'],
    },
    results: [result],
    capability_gaps: [],
    opportunity_signal: { state: 'NONE' },
    truth: {
      projection_decides_truth: false, unknown_policy: 'PRESERVE_UNKNOWN',
      verified_candidate_count: 1, zero_verified_result: false,
      zero_result_reason: null, answerability_frontier: { state: 'ANSWERABLE' },
    },
    ...overrides,
  };
}

test('one request contract bounds market, query, journey, and view', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'SEARCH', market: ['US-MD', 'US-VA'], query: '  Bethesda  ', view: 'map',
  });
  assert.deepEqual({ ...request }, {
    journey: 'SEARCH', market_id: 'US-MD', customer_query: 'Bethesda',
    effective_query: 'Bethesda', requested_view: 'map',
  });
  assert.equal(Object.isFrozen(request), true);
  assert.throws(
    () => normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-PA', query: 'Erie' }),
    /CANA_CUSTOMER_WORLD_MARKET_UNSUPPORTED/,
  );
});

test('merchant profile identity accepts one encoded route segment and rejects path escapes', () => {
  assert.equal(
    normalizeCustomerMerchantId('md-mca%3A0e018719e799ea50b7bc828a'),
    'md-mca:0e018719e799ea50b7bc828a',
  );
  assert.equal(
    normalizeCustomerMerchantId('md-mca:0e018719e799ea50b7bc828a'),
    'md-mca:0e018719e799ea50b7bc828a',
  );
  assert.equal(normalizeCustomerMerchantId('..%2Fadmin'), null);
  assert.equal(normalizeCustomerMerchantId('%E0%A4%A'), null);
});

test('a canonical merchant profile resolves by identity without replaying a search query', () => {
  const market = resolveCustomerMarketContext('US-MD');
  const merchantId = 'md-mca:0e018719e799ea50b7bc828a';
  const decisions = [
    ['facility_name', 'Bethesda Wellness'],
    ['mca_registry_listing_exists', 'Dispensary'],
    ['regulated_address', '1 Wisconsin Ave, Bethesda, MD 20814'],
  ].map(([predicate, value], index) => ({
    claim_id: `claim-${index}`,
    tenant: 'orderweeddc.localhost',
    subject_ref: merchantId,
    predicate,
    value,
    market_id: market.market_id,
    contract_digest: market.evidence.contract_digest,
    source_id: market.evidence.source_key,
    source_url: market.evidence.source_url,
    retrieved_at: '2026-08-13T06:00:00.000Z',
    observed_at: '2026-08-13T06:00:00.000Z',
    verified_at: '2026-08-13T06:05:00.000Z',
    freshness_expires_at: '2026-08-14T06:05:00.000Z',
    verification: 'VERIFIED',
    decision_eligible: true,
    evidence_ref: `market-claim:${index}`,
  }));
  const profile = resolveCustomerMerchantProfileFromReality({
    merchantId,
    marketId: 'US-MD',
    tenantDomain: 'orderweeddc.localhost',
    claimDecisions: decisions,
    now: NOW,
  });
  assert.equal(profile.result.merchant_id, merchantId);
  assert.equal(profile.result.customer_facing_name.value, 'Bethesda Wellness');
  assert.equal(profile.result.location.city.value, 'Bethesda');
  assert.equal(profile.result.delivery_eligibility.state, 'UNKNOWN');
  assert.equal(profile.intent.compiler, 'canonical-merchant-identity-v1');
  assert.equal(profile.intent.raw_query, undefined, 'profile identity is not laundered into search text');
});

test('merchant profile dependency keeps requested-market and all-market selection behavior', async () => {
  const marketSourceKeys = CUSTOMER_DISCOVERY_MARKETS.map(
    (marketId) => resolveCustomerMarketContext(marketId).evidence.source_key,
  );
  const readsFor = () => {
    const sourceKeys = [];
    return {
      prisma: {
        marketClaim: {
          findMany: async ({ where }) => {
            sourceKeys.push(where.snapshot.is.sourceKey);
            return [];
          },
        },
      },
      sourceKeys,
    };
  };

  const requested = readsFor();
  await resolveCustomerMerchantProfile(requested.prisma, {
    merchantId: 'md-mca:missing',
    marketId: 'US-MD',
    tenantDomain: 'orderweeddc.localhost',
    now: NOW,
  });
  assert.deepEqual(
    requested.sourceKeys,
    [resolveCustomerMarketContext('US-MD').evidence.source_key],
    'a string marketId selects only that market',
  );

  const explicitAll = readsFor();
  await resolveCustomerMerchantProfile(explicitAll.prisma, {
    merchantId: 'missing',
    marketId: null,
    tenantDomain: 'orderweeddc.localhost',
    now: NOW,
  });
  assert.deepEqual(explicitAll.sourceKeys, marketSourceKeys, 'null selects all supported markets');

  const omittedAll = readsFor();
  await resolveCustomerMerchantProfile(omittedAll.prisma, {
    merchantId: 'missing',
    tenantDomain: 'orderweeddc.localhost',
    now: NOW,
  });
  assert.deepEqual(omittedAll.sourceKeys, marketSourceKeys, 'omission retains the null default');
});

test('delivery is a first-class route intent, not a retailer type query alias', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'DELIVERY', market: 'US-MD', query: 'Bethesda',
  });
  assert.equal(request.customer_query, 'Bethesda');
  assert.equal(request.effective_query, 'delivery in Bethesda');
  assert.equal(request.journey, 'DELIVERY');
});

test('the same verified result identity powers list, map, and merchant profile discovery', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'DISPENSARIES', market: 'US-MD', query: 'Bethesda', view: 'list',
  });
  const view = buildCustomerWorldView({ request, projection: projection() });
  assert.equal(view.state, 'RESULTS');
  assert.deepEqual(view.results.map((entry) => entry.id), ['merchant-md-1']);
  assert.deepEqual(view.map.markers.map((entry) => entry.id), ['merchant-md-1']);
  assert.equal(view.map.unmappable_count, 0);
  assert.match(view.results[0].profile_href, /^\/merchant\/merchant-md-1\?/);
  assert.match(view.results[0].profile_href, /market=US-MD/);
  assert.match(view.results[0].profile_href, /query=Bethesda/);
});

test('unknown coordinates stay out of the map without removing the list record', () => {
  const withoutCoordinates = projection();
  withoutCoordinates.results[0].location.coordinates = field(
    'UNKNOWN', null, 'VERIFIED_COORDINATES_NOT_AVAILABLE',
  );
  withoutCoordinates.results[0].unknown_dimensions = [
    'location.coordinates', ...withoutCoordinates.results[0].unknown_dimensions,
  ];
  const request = normalizeCustomerWorldRequest({
    journey: 'SEARCH', market: 'US-MD', query: 'Bethesda', view: 'map',
  });
  const view = buildCustomerWorldView({ request, projection: withoutCoordinates });
  assert.equal(view.results.length, 1);
  assert.equal(view.map.markers.length, 0);
  assert.equal(view.map.unmappable_count, 1);
  assert.equal(view.map.state, 'UNKNOWN');
});

test('delivery capability gaps render no merchant as delivery-capable', () => {
  const request = normalizeCustomerWorldRequest({
    journey: 'DELIVERY', market: 'US-MD', query: 'Bethesda',
  });
  const deliveryProjection = projection({
    results: [],
    capability_gaps: [{ state: 'CAPABILITY_GAP', dimension: 'fulfillment', opportunity_signal: true }],
    truth: {
      ...projection().truth,
      verified_candidate_count: 0,
      zero_verified_result: true,
      zero_result_reason: 'UNSUPPORTED_VERIFIED_DIMENSION',
    },
  });
  const view = buildCustomerWorldView({ request, projection: deliveryProjection });
  assert.equal(view.state, 'CAPABILITY_GAP');
  assert.deepEqual(view.unsupported_dimensions, ['fulfillment']);
  assert.equal(view.results.length, 0);
  assert.equal(view.delivery_eligibility.state, 'CAPABILITY_GAP');
});

test('input-required and empty states do not turn absence into market truth', () => {
  const inputRequest = normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-DC' });
  const inputView = buildCustomerWorldView({
    request: inputRequest,
    projection: projection({
      intent: {
        ir_version: 1, compiler: 'deterministic',
        dimensions: { location: { status: 'UNKNOWN', value: null } },
        unknown_dimensions: ['location'],
      },
      results: [],
      truth: {
        ...projection().truth, verified_candidate_count: 0, zero_verified_result: true,
        zero_result_reason: 'REQUIRED_INTENT_DIMENSION_UNKNOWN',
      },
    }),
  });
  assert.equal(inputView.state, 'INPUT_REQUIRED');

  const emptyView = buildCustomerWorldView({
    request: normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-MD', query: 'Bethesda' }),
    projection: projection({
      results: [],
      truth: {
        ...projection().truth, verified_candidate_count: 0, zero_verified_result: true,
        zero_result_reason: 'NO_VERIFIED_CURRENT_MATCH',
      },
    }),
  });
  assert.equal(emptyView.state, 'EMPTY');
  assert.match(emptyView.state_explanation, /not proof/i);
});

test('customer cards expose only projection facts and explicit unknown fields', () => {
  const request = normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-MD', query: 'Bethesda' });
  const view = buildCustomerWorldView({ request, projection: projection() });
  const card = view.results[0];
  assert.equal(card.name.value, 'Bethesda Wellness');
  assert.equal(card.open_now.state, 'UNKNOWN');
  assert.equal(card.price.state, 'UNKNOWN');
  assert.equal(card.inventory.state, 'UNKNOWN');
  assert.equal(card.eta.state, 'UNKNOWN');
  assert.equal(card.service_area.state, 'UNKNOWN');
  assert.equal(card.popularity.state, 'UNKNOWN');
});

test('resolver reads canonical Reality and never falls back to Retailer', async () => {
  let marketClaimReads = 0;
  let retailerReads = 0;
  const prisma = {
    brand: { findUnique: async () => ({ name: 'ORDERWEEDDC' }) },
    marketClaim: { findMany: async () => { marketClaimReads += 1; return []; } },
    marketVerificationEvent: { findMany: async () => [] },
    marketSourceAcquisitionEvent: { findMany: async () => [] },
    marketSourceContentArtifact: { findMany: async () => [] },
    marketSourceSnapshot: { findMany: async () => [] },
    marketEvidenceRevocationEvent: { findMany: async () => [] },
    retailer: { findMany: async () => { retailerReads += 1; return []; } },
  };
  const world = await resolveCustomerWorld(prisma, {
    journey: 'DISPENSARIES', market: 'US-MD', query: 'Bethesda',
    tenantDomain: 'orderweeddc.localhost', now: NOW,
  });
  assert.equal(world.state, 'EMPTY');
  assert.equal(marketClaimReads, 1);
  assert.equal(retailerReads, 0);
});

test('a typed Customer World search records one ASK observation; an empty view records none', async () => {
  const prisma = {
    marketClaim: { findMany: async () => [] },
    marketVerificationEvent: { findMany: async () => [] },
    marketSourceAcquisitionEvent: { findMany: async () => [] },
    marketSourceContentArtifact: { findMany: async () => [] },
    marketSourceSnapshot: { findMany: async () => [] },
    marketEvidenceRevocationEvent: { findMany: async () => [] },
  };
  const observations = [];
  const recordAsk = async (observation) => observations.push(observation);

  const searched = await resolveCustomerWorld(prisma, {
    journey: 'SEARCH', market: 'US-MD', query: 'Bethesda flower under $45',
    tenantDomain: 'orderweeddc.localhost', now: NOW, recordAsk,
  });
  assert.equal(searched.state, 'CAPABILITY_GAP');
  assert.equal(observations.length, 1);
  assert.equal(observations[0].answer.zero_verified_result, true);
  assert.equal(observations[0].intent.raw_query, 'Bethesda flower under $45');

  await resolveCustomerWorld(prisma, {
    journey: 'SEARCH', market: 'US-MD', query: '',
    tenantDomain: 'orderweeddc.localhost', now: NOW, recordAsk,
  });
  assert.equal(observations.length, 1, 'default and empty views are not customer demand');
});

test('the server bridge sends real Customer Discovery output across the ASK boundary', async () => {
  const bridge = await loadServerBridge();
  try {
    const searched = await bridge.loadCustomerWorld({
      journey: 'SEARCH', market: 'US-MD', query: 'Bethesda flower under $45',
      tenantDomain: 'orderweeddc.localhost', now: NOW,
    });
    assert.equal(searched.world.state, 'CAPABILITY_GAP');
    assert.equal(bridge.askWork.persisted.length, 1);
    assert.equal(bridge.askWork.persisted[0].domain, 'orderweeddc.localhost');
    assert.equal(bridge.askWork.persisted[0].answer.market_id, 'US-MD');
    assert.equal(bridge.askWork.persisted[0].answer.verified_candidate_count, 0);
    assert.equal(
      bridge.askWork.persisted[0].answer.answerability_frontier.schema_version,
      'cana-answerability-frontier/v1',
    );
    assert.equal(bridge.askWork.persisted[0].intent.ir_version, 1);
    assert.equal(bridge.askWork.persisted[0].intent.raw_query, 'Bethesda flower under $45');
    assert.equal(persistenceSafeIntent(bridge.askWork.persisted[0].intent).raw_query, undefined);

    await bridge.loadCustomerWorld({
      journey: 'SEARCH', market: 'US-MD', query: '',
      tenantDomain: 'orderweeddc.localhost', now: NOW,
    });
    assert.equal(
      bridge.askWork.persisted.length,
      1,
      'the server bridge records no false demand for an empty view',
    );

    bridge.askWork.setPersistenceAvailable(false);
    const truthful = await bridge.loadCustomerWorld({
      journey: 'SEARCH', market: 'US-MD', query: 'Bethesda',
      tenantDomain: 'orderweeddc.localhost', now: NOW,
    });
    assert.equal(truthful.world.state, 'EMPTY');
    assert.match(truthful.world.state_explanation, /not proof/i);
  } finally {
    bridge.dispose();
  }
});

test('merchant profile dependency accepts string, null, and omitted marketId at compile time', () => {
  const importPath = customerDiscoveryPath.replaceAll('\\', '/');
  const diagnostics = typeFixtureDiagnostics(`
    import { resolveCustomerMerchantProfile } from ${JSON.stringify(importPath)};
    declare const prisma: unknown;
    void resolveCustomerMerchantProfile(prisma, {
      merchantId: 'merchant-md-1', marketId: 'US-MD', tenantDomain: 'orderweeddc.localhost',
    });
    void resolveCustomerMerchantProfile(prisma, {
      merchantId: 'merchant-all-1', marketId: null, tenantDomain: 'orderweeddc.localhost',
    });
    void resolveCustomerMerchantProfile(prisma, {
      merchantId: 'merchant-default-1', tenantDomain: 'orderweeddc.localhost',
    });
  `);
  assert.deepEqual(diagnostics, [], `truthful dependency signature must compile; received ${JSON.stringify(diagnostics)}`);
});

test('the real ASK producer becomes compile-red when its observation shape drifts', () => {
  const producerSource = fs.readFileSync(producerPath, 'utf8');
  const intentSeam = '        intent: discovery.intent,\n';
  const answerSeam = '        answer: discovery.answer,\n';
  assert.equal(
    producerSource.split(intentSeam).length - 1,
    1,
    'the court must mutate exactly one real producer seam',
  );
  assert.equal(producerSource.split(answerSeam).length - 1, 1);
  const baselineDiagnostics = projectDiagnostics({ producerSource });
  assert.deepEqual(
    baselineDiagnostics,
    [],
    `the unmodified project and producer must compile; received ${JSON.stringify(baselineDiagnostics)}`,
  );
  const missingIntentDiagnostics = projectDiagnostics({
    producerSource: producerSource.replace(intentSeam, ''),
  });
  const missingIntentProducerDiagnostics = missingIntentDiagnostics.filter(
    (diagnostic) => path.resolve(diagnostic.fileName ?? '') === producerPath,
  );
  assert.ok(
    missingIntentProducerDiagnostics.some(
      (diagnostic) => diagnostic.message.includes("Property 'intent' is missing"),
    ),
    `missing real intent must fail compilation; received ${JSON.stringify(missingIntentDiagnostics)}`,
  );

  const wrongAnswerDiagnostics = projectDiagnostics({
    producerSource: producerSource.replace(
      answerSeam,
      "        answer: { ...discovery.answer, verified_candidate_count: 'zero' },\n",
    ),
  });
  const wrongAnswerProducerDiagnostics = wrongAnswerDiagnostics.filter(
    (diagnostic) => path.resolve(diagnostic.fileName ?? '') === producerPath,
  );
  assert.ok(
    wrongAnswerProducerDiagnostics.some(
      (diagnostic) => diagnostic.message.includes("Type 'string' is not assignable to type 'number'"),
    ),
    `wrong real answer type must fail compilation; received ${JSON.stringify(wrongAnswerDiagnostics)}`,
  );
});

test('ASK observation failure never hides the truthful Customer World result', async () => {
  const prisma = {
    marketClaim: { findMany: async () => [] },
    marketVerificationEvent: { findMany: async () => [] },
    marketSourceAcquisitionEvent: { findMany: async () => [] },
    marketSourceContentArtifact: { findMany: async () => [] },
    marketSourceSnapshot: { findMany: async () => [] },
    marketEvidenceRevocationEvent: { findMany: async () => [] },
  };
  const world = await resolveCustomerWorld(prisma, {
    journey: 'SEARCH', market: 'US-MD', query: 'Bethesda',
    tenantDomain: 'orderweeddc.localhost', now: NOW,
    recordAsk: async () => { throw new Error('instrumentation unavailable'); },
  });
  assert.equal(world.state, 'EMPTY');
  assert.match(world.state_explanation, /not proof/i);
});

test('W-1 seam: HOME journey compiles evidence-bound home modules; other journeys never do', () => {
  const homeView = buildCustomerWorldView({
    request: normalizeCustomerWorldRequest({ journey: 'HOME', market: 'US-MD', query: 'bethesda' }),
    projection: projection(),
  });
  assert.ok(homeView.home_modules, 'HOME view carries compiled modules');
  const hero = homeView.home_modules.modules.find((m) => m.kind === 'hero_media');
  assert.equal(hero.state, 'UNSOLD_INVENTORY', 'no placements are ever fabricated');
  assert.equal(hero.fallback, 'EDITORIAL_HERO');
  const dispensaries = homeView.home_modules.modules.find((m) => m.kind === 'dispensaries');
  assert.ok(dispensaries, 'the verified card crossed the seam as a dispensary record');
  const searchView = buildCustomerWorldView({
    request: normalizeCustomerWorldRequest({ journey: 'SEARCH', market: 'US-MD', query: 'bethesda' }),
    projection: projection(),
  });
  assert.equal(searchView.home_modules, null, 'SEARCH journey never carries home modules');
});

test('W-1 seam: unknown card dimensions never become deals, placements, or questions', () => {
  const view = buildCustomerWorldView({
    request: normalizeCustomerWorldRequest({ journey: 'HOME', market: 'US-MD', query: 'bethesda' }),
    projection: projection(),
  });
  const deals = view.home_modules.modules.find((m) => m.kind === 'deals');
  if (deals) assert.equal(deals.items.length, 0, 'UNKNOWN deal dimension stays out of the deals module');
  const questions = view.home_modules.modules.find((m) => m.kind === 'local_questions');
  if (questions) assert.equal((questions.items ?? []).length, 0);
});

test('W-1 seam: zero results and unverifiable cards produce no modules — absence stays absence', () => {
  const emptyProjection = projection();
  const view = buildCustomerWorldView({
    request: normalizeCustomerWorldRequest({ journey: 'HOME', market: 'US-MD', query: 'bethesda' }),
    projection: { ...emptyProjection, results: [] },
  });
  assert.equal(view.home_modules, null);

  const records = marketPageRecordsFromCards([
    { id: 'stale', name: field('KNOWN', 'Stale Shop'), verification_state: field('KNOWN', 'STALE'), freshness: field('KNOWN', { verified_at: '2026-08-13T06:05:00.000Z' }) },
    { id: 'nameless', name: field('UNKNOWN'), verification_state: field('KNOWN', 'VERIFIED_CURRENT'), freshness: field('KNOWN', { verified_at: '2026-08-13T06:05:00.000Z' }) },
    { id: 'unfresh', name: field('KNOWN', 'No Freshness'), verification_state: field('KNOWN', 'VERIFIED_CURRENT'), freshness: field('UNKNOWN') },
  ]);
  assert.equal(records.merchants.length, 0, 'nothing unverifiable crosses the seam');
  assert.deepEqual(records.placements, []);
  assert.deepEqual(records.questions, []);
});
