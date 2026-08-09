import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCKERFILE = path.join(ROOT, 'tools', 'postgres-sim', 'Dockerfile');
const POSTGRES_IMAGE =
  'postgres@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f';

function command(commandName, args, {
  allowFailure = false,
  timeout = 120_000,
  maxBuffer = 32 * 1024 * 1024,
} = {}) {
  const result = spawnSync(commandName, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
  });
  if (result.error) throw new Error(`${commandName} failed to start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandName} ${args.join(' ')} exited ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result;
}

function imageTag() {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(DOCKERFILE)).digest('hex');
  return `cana-postgres-verifier:${digest.slice(0, 16)}`;
}

export function ensurePostgresImage() {
  const tag = imageTag();
  const existing = command('docker', ['image', 'inspect', tag], {
    allowFailure: true,
    timeout: 30_000,
  });
  if (existing.status !== 0) {
    command(
      'docker',
      ['build', '--tag', tag, '--file', DOCKERFILE, ROOT],
      { timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 },
    );
  }
  return {
    tag,
    imageId: command('docker', ['image', 'inspect', tag, '--format', '{{.Id}}']).stdout.trim(),
    dockerfileSha256: crypto.createHash('sha256').update(fs.readFileSync(DOCKERFILE)).digest('hex'),
    base: POSTGRES_IMAGE,
  };
}

export function startDisposablePostgres({
  label = 'verify',
  network,
  networkAlias,
  publishLoopback = false,
  sharedNetworkNamespace = false,
} = {}) {
  if (network && !networkAlias) {
    throw new Error('a disposable PostgreSQL network requires an explicit networkAlias');
  }
  if (sharedNetworkNamespace && (!network || !networkAlias || publishLoopback)) {
    throw new Error('sharedNetworkNamespace requires an unpublished PostgreSQL container on an explicit internal network');
  }
  const image = ensurePostgresImage();
  const suffix = crypto.randomBytes(6).toString('hex');
  const name = `cana-postgres-${label.replaceAll(/[^a-z0-9]/g, '')}-${suffix}`;
  const createArgs = [
    'create',
    '--name',
    name,
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env',
    'POSTGRES_DB=cana_verify',
    '--health-cmd',
    'pg_isready -U postgres -d cana_verify',
    '--health-interval',
    '1s',
    '--health-timeout',
    '5s',
    '--health-retries',
    '90',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,noexec,nosuid,size=1g',
  ];
  if (network) createArgs.push('--network', network);
  if (networkAlias) createArgs.push('--network-alias', networkAlias);
  if (publishLoopback) createArgs.push('--publish', '127.0.0.1::5432');
  createArgs.push(image.tag);
  command('docker', createArgs, { timeout: 30_000 });
  try {
    command('docker', ['start', name], { timeout: 30_000 });
    let health = '';
    for (let attempt = 0; attempt < 90; attempt += 1) {
      health = command(
        'docker',
        ['inspect', name, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{end}}'],
        { allowFailure: true, timeout: 5_000 },
      ).stdout.trim();
      if (health === 'healthy') {
        const availableExtensions = command(
          'docker',
          [
            'exec',
            name,
            'psql',
            '-U',
            'postgres',
            '-d',
            'cana_verify',
            '-Atc',
            "SELECT name || '=' || default_version FROM pg_available_extensions WHERE name IN ('postgis','h3','h3_postgis') ORDER BY name",
          ],
          { timeout: 30_000 },
        ).stdout.trim().split('\n');
        if (
          availableExtensions.length !== 3 ||
          !availableExtensions.includes('h3=4.2.3') ||
          !availableExtensions.includes('h3_postgis=4.2.3') ||
          !availableExtensions.some((entry) => /^postgis=3\./.test(entry))
        ) {
          throw new Error(`disposable PostgreSQL extension contract failed: ${availableExtensions.join(', ')}`);
        }
        const systemIdentifier = command(
          'docker',
          [
            'exec',
            name,
            'psql',
            '-U',
            'postgres',
            '-d',
            'cana_verify',
            '-Atc',
            'SELECT system_identifier FROM pg_control_system()',
          ],
          { timeout: 30_000 },
        ).stdout.trim();
        if (!/^\d{10,}$/.test(systemIdentifier)) {
          throw new Error('disposable PostgreSQL system identifier could not be verified out of band');
        }
        const host = sharedNetworkNamespace ? '127.0.0.1' : (networkAlias || '127.0.0.1');
        let port = 5432;
        if (publishLoopback) {
          port = Number(command(
            'docker',
            ['port', name, '5432/tcp'],
            { timeout: 30_000 },
          ).stdout.trim().replace(/^127\.0\.0\.1:/, ''));
          if (!Number.isInteger(port) || port < 1) {
            throw new Error(`disposable PostgreSQL loopback port could not be resolved: ${port}`);
          }
        }
        return {
          name,
          image,
          databaseUrl: `postgresql://postgres@${host}:${port}/cana_verify`,
          systemIdentifier,
          availableExtensions,
        };
      }
      if (health === 'unhealthy') break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    }
    throw new Error(`disposable PostgreSQL did not become healthy; final state=${health || 'unknown'}`);
  } catch (error) {
    command('docker', ['rm', '-f', '-v', name], { allowFailure: true, timeout: 30_000 });
    throw error;
  }
}

export function stopDisposablePostgres(database) {
  if (!database?.name) return true;
  command('docker', ['rm', '-f', '-v', database.name], { allowFailure: true, timeout: 30_000 });
  return command('docker', ['container', 'inspect', database.name], {
    allowFailure: true,
    timeout: 30_000,
  }).status !== 0;
}
