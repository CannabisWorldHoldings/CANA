/**
 * Deployment-integrity guards born from the 2026-07-23 production incident
 * (docs/postmortems/2026-07-23-namecheap-next16-prisma-artifact-incident.md).
 *
 * 1. Command-path consistency: every owner-facing restart/rollback path in
 *    the runbook, deploy script, and verifier must agree on the stable
 *    wrapper paths, and deploy.sh must actually install those wrappers.
 * 2. Artifact-contamination regression (red-before/green-after): an
 *    incomplete "artifact" passes an in-repository smoke test because Node
 *    resolves dependencies from a parent node_modules — and fails once
 *    extracted into true isolation. This test proves BOTH behaviors, which
 *    is exactly why the builder's isolated runtime test exists.
 * 3. Builder source contract: webpack-only build, unresolved-external scan,
 *    and out-of-repo isolation must remain present in the builder.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('command-path consistency: runbook, deploy output, and verifier agree on wrapper paths', () => {
  const runbook = read('NAMECHEAP_CPANEL_DEPLOYMENT.md');
  const deployScript = read('deploy/namecheap/deploy.sh');
  const verifier = read('deploy/namecheap/verify-and-deploy.sh');

  // Canonical owner-facing paths are the stable wrappers.
  assert.match(runbook, /sh ~\/apps\/orderweeddc\/restart\.sh/);
  assert.match(runbook, /sh ~\/apps\/orderweeddc\/rollback\.sh/);

  // deploy.sh must install the wrappers it advertises...
  assert.match(deployScript, /cp "\$APP_HOME\/current\/restart\.sh" "\$APP_HOME\/restart\.sh"/);
  assert.match(deployScript, /cp "\$APP_HOME\/current\/rollback\.sh" "\$APP_HOME\/rollback\.sh"/);
  // ...and advertise exactly the wrapper paths.
  assert.match(deployScript, /sh \$APP_HOME\/restart\.sh/);
  assert.match(deployScript, /sh \$APP_HOME\/rollback\.sh/);

  // The verifier installs the same wrappers and rolls back through them.
  assert.match(verifier, /cp "\$APP_HOME\/current\/restart\.sh" "\$APP_HOME\/restart\.sh"/);
  assert.match(verifier, /sh "\$APP_HOME\/rollback\.sh"/);

  // The stale, contradictory path variant must not reappear in owner docs.
  assert.doesNotMatch(runbook, /apps\/orderweeddc\/current\/restart\.sh/);
});

test('artifact operations emit deploy, restart, and rollback scripts byte-for-byte', () => {
  const courtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-ops-artifact-'));
  let builderCourtRoot;
  try {
    const artifactName = 'orderweeddc-operational-scripts';
    const extractionRoot = path.join(courtRoot, 'extracted');
    fs.mkdirSync(extractionRoot);

    const environment = { ...process.env, CANA_VERIFIED_NODE: process.execPath };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    const verification = JSON.parse(execFileSync(
      path.join(repoRoot, 'deploy/namecheap/build-artifact.mjs'),
      ['--verify-operational-scripts'],
      { cwd: courtRoot, encoding: 'utf8', env: environment },
    ));
    builderCourtRoot = path.dirname(verification.tarPath);
    const operationalScripts = verification.files;
    assert.deepEqual(operationalScripts.slice(0, 4), [
      'deploy.sh',
      'bootstrap-production-db.sh',
      'restart.sh',
      'rollback.sh',
    ], 'the executable builder must emit the deployment and rollback entry points');

    execFileSync('tar', ['-xzf', verification.tarPath, '-C', extractionRoot]);

    const archiveEntries = execFileSync('tar', ['-tzf', verification.tarPath], {
      encoding: 'utf8',
    });
    const archivedFiles = archiveEntries.trim().split('\n');
    for (const script of operationalScripts) {
      assert.ok(
        archivedFiles.includes(`${artifactName}/${script}`),
        `generated artifact must contain ${script}`,
      );
      assert.deepEqual(
        fs.readFileSync(path.join(extractionRoot, 'orderweeddc-operational-scripts', script)),
        fs.readFileSync(path.join(repoRoot, 'deploy/namecheap', script)),
        `packaged ${script} must match its approved source byte-for-byte`,
      );
    }
  } finally {
    fs.rmSync(courtRoot, { recursive: true, force: true });
    if (builderCourtRoot) fs.rmSync(builderCourtRoot, { recursive: true, force: true });
  }
});

test('contamination regression: parent node_modules falsely satisfies an incomplete artifact; isolation catches it', () => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-contam-'));
  try {
    // A dependency that exists ONLY in the parent directory tree.
    const ghostDir = path.join(fixtureParent, 'node_modules/ghost-dep');
    fs.mkdirSync(ghostDir, { recursive: true });
    fs.writeFileSync(
      path.join(ghostDir, 'package.json'),
      JSON.stringify({ name: 'ghost-dep', version: '1.0.0', main: 'index.js' }),
    );
    fs.writeFileSync(path.join(ghostDir, 'index.js'), "module.exports = 'ghost';\n");

    // An "artifact" that forgot to bundle its dependency.
    const artifactDir = path.join(fixtureParent, 'artifact');
    fs.mkdirSync(artifactDir);
    fs.writeFileSync(
      path.join(artifactDir, 'app.cjs'),
      "console.log(require('ghost-dep'));\n",
    );

    // RED (the old, broken methodology): run the artifact beneath the parent
    // tree — Node's upward resolution finds ghost-dep and the test FALSELY
    // passes, exactly how the Turbopack artifact passed the old smoke test.
    const contaminated = execFileSync(process.execPath, ['app.cjs'], {
      cwd: artifactDir,
      encoding: 'utf8',
    });
    assert.equal(contaminated.trim(), 'ghost', 'in-repo run must falsely succeed');

    // GREEN (the mandated methodology): the SAME artifact bytes extracted to
    // true isolation fail immediately — the incompleteness is caught.
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-isolated-fixture-'));
    try {
      fs.cpSync(artifactDir, path.join(isolated, 'artifact'), { recursive: true });
      assert.throws(
        () =>
          execFileSync(process.execPath, ['app.cjs'], {
            cwd: path.join(isolated, 'artifact'),
            encoding: 'utf8',
            stdio: 'pipe',
            env: { PATH: process.env.PATH }, // cleared env: no NODE_PATH
          }),
        /Cannot find module 'ghost-dep'|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/,
        'isolated run must expose the missing dependency',
      );
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(fixtureParent, { recursive: true, force: true });
  }
});

test('builder contract: webpack-only, unresolved-external scan, out-of-repo isolation', () => {
  const builder = read('deploy/namecheap/build-artifact.mjs');
  assert.match(builder, /next build --webpack/, 'Namecheap artifact must build with webpack');
  assert.doesNotMatch(builder, /next build --turbo/, 'Turbopack must not build this artifact');
  assert.match(builder, /@prisma\\\/client-\[0-9a-f\]\{8,\}/, 'hashed-external scan pattern must exist');
  assert.match(builder, /mkdtempSync\(path\.join\(os\.tmpdir\(\)/, 'isolation must extract outside the repository');
  assert.match(builder, /isolatedRuntimeTest/, 'isolated runtime results must reach the receipt');
  assert.match(builder, /bundler: 'webpack'/, 'receipt must record the bundler');
  assert.match(
    builder,
    /createReleaseChildEnvironment/,
    'every release child must use the verified Node path and sanitized environment',
  );

  const gates = read('deploy/namecheap/PRODUCTION_RELEASE_GATES.md');
  assert.match(gates, /Turbopack standalone output is BANNED/);
  const signatures = JSON.parse(read('deploy/namecheap/failure-signatures.json'));
  assert.ok(signatures.signatures.length >= 10, 'failure KB must cover the incident classes');
  for (const entry of signatures.signatures) {
    for (const field of ['signature', 'layer', 'confidence', 'safeDiagnostic', 'prohibitedAction']) {
      assert.ok(entry[field], `signature missing ${field}`);
    }
  }
});

test('Namecheap startup preserves the externally owned SQLite file', () => {
  const launcher = read('deploy/namecheap/app.js');
  const prisma = read('apps/web/src/lib/prisma.ts');
  const guard = "process.env.CANA_PRESERVE_SQLITE_FILE_BYTES = '1'";

  assert.match(launcher, /CANA_PRESERVE_SQLITE_FILE_BYTES = '1'/);
  assert.ok(
    launcher.indexOf(guard) < launcher.indexOf("require('./server.js')"),
    'the byte-preservation boundary must be established before Next.js starts',
  );
  assert.match(prisma, /preservePersistentPragmas:\s*process\.env\.CANA_PRESERVE_SQLITE_FILE_BYTES === '1'/);
});
