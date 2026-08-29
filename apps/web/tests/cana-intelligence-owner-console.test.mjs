import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageSource = fs.readFileSync(path.join(webRoot, 'src/app/admin/console/page.tsx'), 'utf8');
const adapterSource = fs.readFileSync(path.join(webRoot, 'src/lib/cana-intelligence/canonical-owner-adapter.ts'), 'utf8');

test('existing Owner console is wired to authenticated canonical read-only CANA inputs', () => {
  assert.match(pageSource, /createOwnerCanaIntelligenceAdapters/);
  assert.ok(
    pageSource.indexOf('await requireAdmin()') < pageSource.indexOf('createOwnerCanaIntelligenceAdapters()'),
    'the incumbent admin gate must run before constructing the Owner bridge',
  );
  for (const read of [
    'resolveVerifiedPrincipal',
    'loadVerifiedSupply',
    'loadObservations',
    'loadIntentEvents',
  ]) assert.match(pageSource, new RegExp(`intelligence\\.${read}\\(\\)`));
  assert.match(pageSource, /data-cana-owner-bridge="read-only"/);
  assert.match(pageSource, /Command, promotion, and execution effects remain unavailable here/);
  assert.doesNotMatch(pageSource, /persistReceipt|persistLesson|persistPrediction|persistExperiment/);
});

test('Owner adapter fixes custody to the canonical tenant and accepts no caller tenant', () => {
  assert.match(adapterSource, /export function createOwnerCanaIntelligenceAdapters\(\)/);
  assert.match(adapterSource, /tenant: CANONICAL_TENANT_DOMAIN/);
  assert.match(adapterSource, /experience: createFullFabricAdapter\(canonicalHost\)/);
  assert.match(adapterSource, /site: createSiteCortexAdapter\(canonicalHost\)/);
  assert.doesNotMatch(adapterSource, /createOwnerCanaIntelligenceAdapters\([^)]*tenant/);
});
