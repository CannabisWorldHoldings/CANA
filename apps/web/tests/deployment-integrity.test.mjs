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
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(webRoot, '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const ownerArtifactCourt = path.join(
  repoRoot,
  'deploy/namecheap/verify-owner-artifact-input.sh',
);

function sha256(target) {
  return createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function createOwnerArtifactFixture(root, kind) {
  const artifactRoot = 'orderweeddc-structural-court';
  const artifact = path.join(root, `${kind}.tar.gz`);
  if (kind === 'malformed') {
    fs.writeFileSync(artifact, Buffer.from('not-a-tar-archive'));
  } else {
    execFileSync('python3', ['-c', String.raw`
import io
import json
import sys
import tarfile

archive_path, artifact_root, kind = sys.argv[1:]
files = {
    "deploy.sh": b"#!/bin/sh\nexit 0\n",
    "release.json": (json.dumps({"gitSha": "a" * 40, "artifact": artifact_root}) + "\n").encode(),
    ".next/BUILD_ID": b"structural-build-id\n",
    "src/metadata-markers.txt": b"LIBARCHIVE.xattr\nSCHILY.xattr\ncom.apple.provenance\ncom.apple.ResourceFork\ncom.apple.FinderInfo\n",
    "public/icon.ico": b"\x00\x00\x01\x00\x00binary\x00ico",
    "public/icon.png": b"\x89PNG\r\n\x1a\n\x00binary\x00png",
    ".next/server/app/page.js": b"compiled\x00output\n",
}
if kind == "appledouble":
    files["._example"] = b"appledouble"
    files[".DS_Store"] = b"finder"
    files["__MACOSX/resource-fork"] = b"fork"

with tarfile.open(archive_path, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
    for relative_name, payload in files.items():
        member = tarfile.TarInfo(f"{artifact_root}/{relative_name}")
        member.size = len(payload)
        member.mtime = 0
        member.mode = 0o755 if relative_name == "deploy.sh" else 0o644
        if kind == "pax" and relative_name == "src/metadata-markers.txt":
            member.pax_headers = {"LIBARCHIVE.xattr.com.apple.provenance": "forbidden"}
        archive.addfile(member, io.BytesIO(payload))
`, artifact, artifactRoot, kind]);
  }
  const sidecar = `${artifact}.sha256`;
  fs.writeFileSync(sidecar, `${sha256(artifact)}  ${path.basename(artifact)}\n`);
  return {
    artifact,
    artifactRoot,
    sidecar,
    state: path.join(root, `${kind}-state`),
  };
}

function runOwnerArtifactCourt(fixture) {
  return spawnSync('bash', [
    ownerArtifactCourt,
    fixture.artifact,
    sha256(fixture.artifact),
    fixture.sidecar,
    sha256(fixture.sidecar),
    fixture.artifactRoot,
    'a'.repeat(40),
    'structural-build-id',
    fixture.state,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
}

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

test('clean artifact packaging rejects AppleDouble, Finder metadata, resource forks, and provenance headers', () => {
  let builderCourtRoot;
  try {
    const environment = { ...process.env, CANA_VERIFIED_NODE: process.execPath };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    const verification = JSON.parse(execFileSync(
      path.join(repoRoot, 'deploy/namecheap/build-artifact.mjs'),
      ['--verify-clean-packaging'],
      { cwd: repoRoot, encoding: 'utf8', env: environment },
    ));
    builderCourtRoot = path.dirname(verification.tarPath);

    assert.ok(
      verification.members.includes('orderweeddc-clean-tar-fixture/release.json'),
      'ordinary artifact files must remain packaged',
    );
    assert.ok(
      verification.members.every((member) => {
        const parts = member.split('/').filter(Boolean);
        return !parts.some((part) => (
          part.startsWith('._') || part === '.DS_Store' || part === '__MACOSX'
        ));
      }),
      'no archive member may contain AppleDouble, Finder, or __MACOSX metadata',
    );
    assert.equal(verification.packagingAudit.rejectedMembers.length, 0);
    assert.equal(verification.packagingAudit.macOsExtendedHeaderCount, 0);
    assert.equal(
      verification.provenanceHeaderRejected,
      true,
      'LIBARCHIVE/SCHILY macOS xattr headers and resource forks must fail closed',
    );

    const builder = read('deploy/namecheap/build-artifact.mjs');
    assert.match(builder, /COPYFILE_DISABLE: '1'/);
    assert.match(builder, /COPY_EXTENDED_ATTRIBUTES_DISABLE: '1'/);
    assert.match(builder, /--no-xattrs/);
    assert.match(builder, /--no-mac-metadata/);
    assert.match(builder, /--exclude=\._\*/);
    assert.match(builder, /--exclude=\.DS_Store/);
    assert.match(builder, /--exclude=__MACOSX/);
  } finally {
    if (builderCourtRoot) fs.rmSync(builderCourtRoot, { recursive: true, force: true });
  }
});

test('owner artifact input court separates tar metadata from ordinary text and binary bytes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owd-owner-artifact-input-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await t.test('clean content markers and binary null bytes pass structurally', () => {
    const result = runOwnerArtifactCourt(createOwnerArtifactFixture(root, 'clean'));
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /STRUCTURAL_PAX_HEADER_AUDIT=PASS/);
    assert.match(result.stdout, /BINARY_SAFE_ARCHIVE_INPUT_GATE=PASS/);
    assert.doesNotMatch(result.stderr, /ignored null byte|FORBIDDEN_/i);
  });

  await t.test('a real forbidden PAX xattr header fails before deployment', () => {
    const result = runOwnerArtifactCourt(createOwnerArtifactFixture(root, 'pax'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FORBIDDEN_PAX_HEADER/);
    assert.match(result.stderr, /DEPLOYMENT_STARTED=NO/);
    assert.match(result.stderr, /AUTOMATIC_ROLLBACK_EXECUTED=NO/);
  });

  await t.test('AppleDouble, Finder, and __MACOSX members fail before deployment', () => {
    const result = runOwnerArtifactCourt(createOwnerArtifactFixture(root, 'appledouble'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FORBIDDEN_MACOS_MEMBER/);
    assert.match(result.stderr, /DEPLOYMENT_STARTED=NO/);
    assert.match(result.stderr, /AUTOMATIC_ROLLBACK_EXECUTED=NO/);
  });

  await t.test('a malformed archive fails before deployment', () => {
    const result = runOwnerArtifactCourt(createOwnerArtifactFixture(root, 'malformed'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ARCHIVE_HEADER_INSPECTION_FAILED/);
    assert.match(result.stderr, /DEPLOYMENT_STARTED=NO/);
    assert.match(result.stderr, /AUTOMATIC_ROLLBACK_EXECUTED=NO/);
  });
});

test('owner artifact input court captures only bounded textual values in shell variables', () => {
  const court = read('deploy/namecheap/verify-owner-artifact-input.sh');
  assert.doesNotMatch(court, /\$\(gzip\s+-dc/);
  assert.doesNotMatch(court, /\$\(tar\s+-xOf/);
  assert.doesNotMatch(court, /\$\(cat\s+/);
  assert.doesNotMatch(court, /artifact_member_matches/);
  assert.match(court, /artifact_actual_sha=\$\(sha256sum/);
  assert.match(court, /PYTHON=\$\(command -v python3/);
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
