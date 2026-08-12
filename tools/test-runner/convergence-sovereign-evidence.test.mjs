import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE = path.join(ROOT, 'docs', 'technical-promotion', 'sovereign');

const CAPABILITY_STATES = new Set([
  'VERIFIED_IMPLEMENTED',
  'PARTIALLY_IMPLEMENTED',
  'PLANNED',
  'RESEARCH_ONLY',
  'BLOCKED',
  'FALSIFIED',
]);

const DISPOSITIONS = new Set([
  'CANONICAL',
  'SUPERSEDED_BY',
  'ADAPT',
  'ABSORB',
  'HAND_PORT',
  'FUNCTIONAL_DONOR',
  'VISUAL_DONOR',
  'OWNER_REJECTED',
  'ARCHIVE',
  'RETIRE',
]);

function loadJson(name) {
  const file = path.join(EVIDENCE, name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function nonEmptyString(value, message) {
  assert.equal(typeof value, 'string', message);
  assert.notEqual(value.trim(), '', message);
}

test('three-face truth map keeps one reality and three purpose-built projections', () => {
  const truthMap = loadJson('THREE_FACE_TRUTH_MAP.json');
  assert.equal(truthMap.SCHEMA_VERSION, 1);
  assert.equal(truthMap.CANONICAL_BASE, 'c436e3742929af71ee6cd45acc47fb2cabd55fef');
  assert.deepEqual(
    truthMap.FACES.map((face) => face.ID).sort(),
    ['CANA_OWNER', 'CUSTOMER', 'MERCHANT'],
  );

  const requiredFaceFields = [
    'PURPOSE',
    'USERS',
    'PRIMARY_JOBS',
    'ROUTES',
    'NAVIGATION_IDENTITY',
    'INFORMATION_DENSITY',
    'VOCABULARY',
    'PERMISSIONS',
    'VISUAL_LANGUAGE',
    'CURRENT_STATE',
  ];
  for (const face of truthMap.FACES) {
    for (const field of requiredFaceFields) assert.ok(field in face, `${face.ID}.${field} is required`);
    nonEmptyString(face.PURPOSE, `${face.ID}.PURPOSE must be non-empty`);
    assert.ok(Array.isArray(face.USERS) && face.USERS.length > 0);
    assert.ok(Array.isArray(face.PRIMARY_JOBS) && face.PRIMARY_JOBS.length > 0);
    assert.ok(Array.isArray(face.ROUTES) && face.ROUTES.length > 0);
    assert.ok(Array.isArray(face.PERMISSIONS) && face.PERMISSIONS.length > 0);
    assert.ok(CAPABILITY_STATES.has(face.CURRENT_STATE.STATUS));
  }

  for (const field of ['NAVIGATION_IDENTITY', 'INFORMATION_DENSITY', 'VOCABULARY', 'VISUAL_LANGUAGE']) {
    assert.equal(new Set(truthMap.FACES.map((face) => JSON.stringify(face[field]))).size, 3, `${field} must differ by face`);
  }

  const customer = truthMap.FACES.find((face) => face.ID === 'CUSTOMER');
  for (const route of ['/', '/search', '/delivery', '/dispensaries', '/products', '/deals', '/neighborhoods']) {
    assert.ok(customer.ROUTES.includes(route), `customer route ${route} is required`);
  }

  assert.equal(truthMap.SHARED_REALITY.AUTHORITY, 'CANA_VERIFIED_REALITY');
  assert.equal(truthMap.SHARED_REALITY.UNKNOWN_POLICY, 'PRESERVE_UNKNOWN');
  assert.equal(truthMap.SHARED_REALITY.PAID_ORGANIC_POLICY, 'PAID_NEVER_ALTERS_ORGANIC_TRUTH');
  assert.equal(truthMap.MARKET_SCOPE.NO_MARKET_4, true);
  assert.deepEqual(truthMap.MARKET_SCOPE.MARKETS.map((market) => market.ID).sort(), ['DC', 'MD', 'VA']);

  const delivery = truthMap.PROJECTION_EXAMPLES.find((entry) => entry.FACT === 'DELIVERY_ELIGIBILITY');
  assert.ok(delivery, 'delivery eligibility projection is required');
  assert.deepEqual(Object.keys(delivery.PROJECTIONS).sort(), ['CANA_OWNER', 'CUSTOMER', 'MERCHANT']);
  assert.equal(
    new Set(Object.values(delivery.PROJECTIONS).map((projection) => projection.REALITY_ID)).size,
    1,
    'all delivery projections must bind the same reality identity',
  );
  assert.equal(delivery.ELIGIBILITY_CHAIN.at(0), 'CUSTOMER_LOCATION');
  assert.equal(delivery.ELIGIBILITY_CHAIN.at(-1), 'RESULT');
});

test('capability conservation ledger accounts for requested donors without silent loss', () => {
  const ledger = loadJson('CAPABILITY_CONSERVATION_LEDGER.json');
  assert.equal(ledger.SCHEMA_VERSION, 1);
  assert.equal(ledger.CANONICAL_MAIN, 'c436e3742929af71ee6cd45acc47fb2cabd55fef');
  assert.deepEqual(new Set(ledger.ALLOWED_DISPOSITIONS), DISPOSITIONS);
  assert.ok(Array.isArray(ledger.CAPABILITIES) && ledger.CAPABILITIES.length >= 20);

  const requiredFields = [
    'SOURCE',
    'ORIGINAL_PURPOSE',
    'CURRENT_EQUIVALENT',
    'CURRENT_STATE',
    'OWNER_DECISION',
    'TARGET_CANONICAL_SEAM',
    'DEPENDENCIES',
    'PROOF',
    'DISPOSITION',
  ];
  const requiredSources = ['PR #21', 'PR #22', 'PR #24', 'PR #25', 'PR #28', 'PR #30', 'PR #31', 'PR #32', 'PR #33', 'PR #34'];
  for (const source of requiredSources) {
    assert.ok(ledger.CAPABILITIES.some((entry) => entry.SOURCE === source), `${source} must be accounted for`);
  }

  for (const entry of ledger.CAPABILITIES) {
    for (const field of requiredFields) assert.ok(field in entry, `${entry.CAPABILITY ?? entry.SOURCE}.${field} is required`);
    nonEmptyString(entry.SOURCE, 'SOURCE must be non-empty');
    nonEmptyString(entry.ORIGINAL_PURPOSE, `${entry.SOURCE}.ORIGINAL_PURPOSE must be non-empty`);
    nonEmptyString(entry.CURRENT_EQUIVALENT, `${entry.SOURCE}.CURRENT_EQUIVALENT must be non-empty`);
    assert.ok(CAPABILITY_STATES.has(entry.CURRENT_STATE), `${entry.SOURCE}.CURRENT_STATE is invalid`);
    nonEmptyString(entry.OWNER_DECISION, `${entry.SOURCE}.OWNER_DECISION must be non-empty`);
    nonEmptyString(entry.TARGET_CANONICAL_SEAM, `${entry.SOURCE}.TARGET_CANONICAL_SEAM must be non-empty`);
    assert.ok(Array.isArray(entry.DEPENDENCIES));
    assert.ok(Array.isArray(entry.PROOF) && entry.PROOF.length > 0);
    assert.ok(DISPOSITIONS.has(entry.DISPOSITION), `${entry.SOURCE}.DISPOSITION is invalid`);
    for (const proof of entry.PROOF) {
      nonEmptyString(proof.REF, `${entry.SOURCE}.PROOF.REF must be non-empty`);
      nonEmptyString(proof.EVIDENCE, `${entry.SOURCE}.PROOF.EVIDENCE must be non-empty`);
      assert.ok(CAPABILITY_STATES.has(proof.STATE), `${entry.SOURCE}.PROOF.STATE is invalid`);
    }
  }

  const pr21 = ledger.CAPABILITIES.filter((entry) => entry.SOURCE === 'PR #21');
  assert.ok(pr21.some((entry) => entry.DISPOSITION === 'FUNCTIONAL_DONOR'));
  assert.ok(pr21.some((entry) => entry.DISPOSITION === 'OWNER_REJECTED'));
  assert.ok(ledger.CAPABILITIES.some((entry) => entry.SOURCE === 'CURRENT CANONICAL MAIN'));
});

test('first report records live identities, requested states and the owner-gated phase boundary', () => {
  const report = loadJson('FIRST_REPORT.json');
  const requiredFields = [
    'CURRENT_MAIN',
    'CURRENT_PRODUCTION_SHA',
    'PR45_HEAD',
    'PR45_HOSTED_CI',
    'PR45_VERDICT',
    'WHY_CURRENT_PUBLIC_UI_IS_MISSING_LATER_WORK',
    'CUSTOMER_WORLD_CURRENT_STATE',
    'MERCHANT_WORLD_CURRENT_STATE',
    'CANA_WORLD_CURRENT_STATE',
    'PR21_DISPOSITION',
    'PR22_DISPOSITION',
    'PR24_DISPOSITION',
    'PR25_DISPOSITION',
    'PR28_DISPOSITION',
    'PR30_DISPOSITION',
    'PR31_DISPOSITION',
    'PR32_DISPOSITION',
    'PR33_DISPOSITION',
    'PR34_DISPOSITION',
    'APPLE_UI_MISSING_COMPONENTS',
    'SOVEREIGN_GAUNTLET_STATE',
    'ASK_SEARCH_GAPS',
    'DELIVERY_GAPS',
    'HERMES_CURRENT_STATE',
    'SITEMIND_CURRENT_STATE',
    'GROWTH_WATCH_STATE',
    'SEO_AEO_STATE',
    'BACKLINK_STATE',
    'OUTREACH_STATE',
    'CREATIVE_IMAGE_STATE',
    'BILLBOARD_STATE',
    'ATTRIBUTION_STATE',
    'FAILURE_MEMORY_STATE',
    'MISSING_CONNECTIVE_TISSUE',
  ];
  for (const field of requiredFields) assert.ok(field in report, `${field} is required`);

  assert.equal(report.CURRENT_MAIN, 'c436e3742929af71ee6cd45acc47fb2cabd55fef');
  assert.equal(report.CURRENT_PRODUCTION_SHA, 'b993a2d5252380472b20ab4565ce07da9df1e61d');
  assert.equal(report.PR45_HEAD, '0de5f8b4d8e47735576c3f73ce99e9ecaf026e93');
  assert.equal(report.PR45_READY_FOR_OWNER_MERGE, true);
  assert.equal(report.PR45_MERGED, true);
  assert.equal(report.PR45_MERGE_COMMIT, report.CURRENT_MAIN);
  assert.deepEqual(report.PR45_MERGE_PARENTS, [report.PR45_BASE, report.PR45_HEAD]);
  assert.equal(report.PR45_REVIEWED_HEAD_IN_MAIN_ANCESTRY, true);
  assert.equal(report.PR45_REVIEW_STATE.UNRESOLVED_THREADS, 0);
  assert.equal(report.PR45_OPERATIONAL_GATE, 'CANONICALIZED');
  assert.equal(report.PHASE_BOUNDARY, 'ASK_CUSTOMER_DISCOVERY_CANDIDATE_REVIEW');
  assert.equal(report.PRODUCT_IMPLEMENTATION_STARTED, true);
  assert.equal(report.FIRST_BOUNDED_PRODUCT_SLICE.STATUS, 'LOCAL_CANDIDATE_IMPLEMENTED');
  assert.deepEqual(report.FIRST_BOUNDED_PRODUCT_SLICE.SURFACES, [
    'apps/web/src/lib/ask/intent-ir.mjs',
    'apps/web/src/lib/ask/ask-service.mjs',
    'apps/web/tests/ask-intent-ir.test.mjs',
    'apps/web/tests/ask-service-where.test.mjs',
  ]);
  assert.deepEqual(report.FIRST_BOUNDED_PRODUCT_SLICE.MARKETS, ['US-DC', 'US-MD', 'US-VA']);
  assert.deepEqual(report.FIRST_BOUNDED_PRODUCT_SLICE.TRUTH_STATES, ['KNOWN', 'UNKNOWN', 'CAPABILITY_GAP']);
  assert.equal(report.FIRST_BOUNDED_PRODUCT_SLICE.NO_SECOND_SEARCH_ENGINE, true);
  assert.equal(report.FIRST_BOUNDED_PRODUCT_SLICE.PROJECTION_DECIDES_TRUTH, false);
  assert.equal(report.FIRST_BOUNDED_PRODUCT_SLICE.PRODUCTION_EFFECTS, 0);
  assert.equal(report.PRODUCTION_MUTATED, false);
  assert.equal(report.NO_MARKET_4, true);
  assert.equal(report.PR45_HOSTED_CI.RUN_ID, 31624478534);
  assert.equal(report.PR45_HOSTED_CI.CONCLUSION, 'SUCCESS');
  assert.equal(report.POST_MERGE_CI.RUN_ID, 31625316460);
  assert.equal(report.POST_MERGE_CI.EXACT_MAIN, report.CURRENT_MAIN);
  assert.equal(report.POST_MERGE_CI.CONCLUSION, 'SUCCESS');
  assert.equal(report.EXTERNAL_EFFECTS.MERGE, 1);
});
