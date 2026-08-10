import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WEB, '..', '..');
const RETIREMENT_MESSAGE =
  'CANA_LEGACY_ABCA_PATH_RETIRED: Legacy ABCA import paths are retired. Use the canonical Phase B compile/court commands: ' +
  'node apps/web/scripts/compile-market-reality.mjs and node apps/web/scripts/verify-market-reality.mjs.';

const legacyScripts = [
  { name: 'etl-abca-retailers.mjs', args: ['--dry-run'] },
  { name: 'ingest-abca-feed.mjs', args: ['--dry-run'] },
  {
    name: 'seed-abca-retailers.mjs',
    args: ['--dry-run', '--universe=/this/path-must-not-be-read.json'],
  },
];

const legacyInputs = [
  path.join(WEB, 'scripts', 'real_abca_feed.csv'),
  path.join(WEB, 'scripts', 'mock_abca_feed.csv'),
  path.join(REPO, 'docs', 'competitive', 'dc-merchant-universe.json'),
];

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('legacy ABCA writer CLIs refuse before Prisma, feed, or database access', () => {
  const before = new Map(legacyInputs.map((file) => [file, sha256(file)]));
  const dbProbe = fs.mkdtempSync(path.join(os.tmpdir(), 'cana-legacy-abca-db-'));

  try {
    for (const { name, args } of legacyScripts) {
      const source = fs.readFileSync(path.join(WEB, 'scripts', name), 'utf8');
      assert.doesNotMatch(source, /^\s*import\s/m, `${name} must not import dependencies`);
      assert.doesNotMatch(source, /PrismaClient|@prisma\/client|readFile|fetch\s*\(/, `${name} retains a side-effect path`);
      assert.match(source, /CANA_LEGACY_ABCA_PATH_RETIRED/);

      const result = spawnSync(process.execPath, [path.join(WEB, 'scripts', name), ...args], {
        cwd: REPO,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://127.0.0.1:9/legacy_abca_retirement_probe',
          DIRECT_URL: 'postgresql://127.0.0.1:9/legacy_abca_retirement_probe',
          CANA_LEGACY_ABCA_DB_PROBE: dbProbe,
        },
      });

      assert.equal(result.status, 1, `${name} must exit with status 1`);
      assert.equal(result.signal, null, `${name} must not be terminated by a signal`);
      assert.equal(result.stdout, '', `${name} must not emit a success result`);
      assert.equal(result.stderr.trim(), RETIREMENT_MESSAGE, `${name} retirement message changed`);
    }

    for (const file of legacyInputs) {
      assert.equal(sha256(file), before.get(file), `${path.relative(REPO, file)} was mutated`);
    }
    assert.deepEqual(fs.readdirSync(dbProbe), [], 'legacy scripts created database artifacts');
  } finally {
    fs.rmSync(dbProbe, { recursive: true, force: true });
  }
});
