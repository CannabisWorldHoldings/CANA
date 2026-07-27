import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATES = path.join(ROOT, 'tools', 'cpanel-sim', 'templates');

test('the cPanel simulator exposes a runnable verification surface', async () => {
  const module = await import('./run.mjs');
  assert.equal(typeof module.runCpanelSimulation, 'function');
});

test('the package contains explicit web worker migration backup and restore launchers', () => {
  for (const file of [
    'web-launcher.sh',
    'worker-launcher.sh',
    'migrate.sh',
    'backup.sh',
    'restore.sh',
    'app-server.mjs',
    'worker.mjs',
    'sqlite-tool.mjs',
    'passenger-server.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(TEMPLATES, file)), true, file);
  }
});

test('the real Prisma proof is an executable container surface', () => {
  const proof = path.join(ROOT, 'tools', 'cpanel-sim', 'real-prisma-proof.sh');
  assert.equal(fs.existsSync(proof), true);
  const source = fs.readFileSync(proof, 'utf8');
  assert.doesNotMatch(source, /\bnpm\s+(?:ci|install)\b/);
  assert.match(source, /npx --no-install prisma generate/);
  assert.match(source, /CHECKPOINTED/);
  assert.match(source, /db-inspect\.mjs/);
});

test('the simulated web process labels itself and exposes all operational probes', () => {
  const server = fs.readFileSync(path.join(TEMPLATES, 'app-server.mjs'), 'utf8');
  assert.match(server, /CPANEL_SIMULATION/);
  for (const route of ['/api/health', '/api/ready', '/api/release']) {
    assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
  }
});
