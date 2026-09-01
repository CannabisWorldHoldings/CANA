import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { createCanonicalCanaAdapter } from '../src/lib/cana-intelligence/canonical-adapter.mjs';
import { createFullFabricAdapter } from '../src/lib/cana-intelligence/full-fabric-adapter.mjs';
import { createCanonicalWeldHost } from '../src/lib/cana-intelligence/canonical-host.mjs';
import { createCanonicalEvidenceAdapter } from '../src/lib/cana-intelligence/receipts.mjs';
import { createSiteCortexAdapter } from '../src/lib/cana-intelligence/site-cortex.mjs';
import { CANONICAL_TENANT_DOMAIN } from '../src/lib/tenant-host.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageSource = fs.readFileSync(path.join(webRoot, 'src/app/admin/console/page.tsx'), 'utf8');
const adapterSource = fs.readFileSync(path.join(webRoot, 'src/lib/cana-intelligence/canonical-owner-adapter.ts'), 'utf8');

function executeOwnerAdapterModule() {
  const hostOptions = [];
  const prisma = { canaEvidenceReceipt: {}, canaIntelligenceRecord: {} };
  const dependencies = new Map([
    ['server-only', {}],
    ['../auth/session', { assertAdmin: async () => ({ role: 'ADMIN' }) }],
    ['../prisma', { prisma }],
    ['./canonical-adapter.mjs', { createCanonicalCanaAdapter }],
    ['./full-fabric-adapter.mjs', { createFullFabricAdapter }],
    ['./canonical-host.mjs', {
      createCanonicalWeldHost: (options) => {
        hostOptions.push(options);
        return createCanonicalWeldHost(options);
      },
    }],
    ['./receipts.mjs', { createCanonicalEvidenceAdapter }],
    ['./site-cortex.mjs', { createSiteCortexAdapter }],
    ['../tenant-host.mjs', { CANONICAL_TENANT_DOMAIN }],
  ]);
  const compiled = ts.transpileModule(adapterSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: compiledModule.exports,
    module: compiledModule,
    require: (specifier) => {
      assert.ok(dependencies.has(specifier), `unexpected Owner adapter dependency: ${specifier}`);
      return dependencies.get(specifier);
    },
  });
  return { createAdapters: compiledModule.exports.createOwnerCanaIntelligenceAdapters, hostOptions };
}

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

test('Owner adapter fixes custody to the canonical tenant and does not expose an incomplete Experience facade', async () => {
  const { createAdapters, hostOptions } = executeOwnerAdapterModule();
  assert.equal(createAdapters.length, 0);
  const adapters = createAdapters();
  assert.equal(hostOptions.length, 1);
  assert.equal(hostOptions[0].tenant, CANONICAL_TENANT_DOMAIN);
  assert.equal(hostOptions[0].experience, undefined);
  assert.equal(Object.hasOwn(adapters, 'experience'), false);
  assert.deepEqual(
    (await adapters.site.enumerateExperienceSurfaces()).map(({ route }) => route),
    ['/', '/search', '/delivery', '/dispensaries'],
  );
  assert.equal(await adapters.site.captureRenderedEvidenceReceipt({ route: '/' }), null);
});
