/**
 * SOVEREIGN ENVIRONMENT PROBES
 * ============================
 * Every probe answers one question with first-hand evidence and never guesses.
 * A stage that finds its probe false reports ENVIRONMENT_MISSING and names the
 * exact thing that is absent. Nothing here can make a stage pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function which(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  if (result.error) {
    return { present: false, why: `${binary}: ${result.error.code ?? result.error.message}` };
  }
  return {
    present: result.status === 0,
    version: `${result.stdout || result.stderr}`.trim().split('\n')[0] ?? null,
    why: result.status === 0 ? null : `${binary} exited ${result.status}`,
  };
}

export function dockerUsable() {
  const cli = which('docker');
  if (!cli.present) return { present: false, why: `docker CLI absent (${cli.why})` };
  const info = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 30_000 });
  if (info.error) return { present: false, why: `docker info: ${info.error.code ?? info.error.message}` };
  if (info.status !== 0) return { present: false, why: `docker daemon unreachable (docker info exited ${info.status})` };
  return { present: true, version: cli.version };
}

export function nodeModules(root) {
  const rootMods = path.join(root, 'node_modules');
  const webMods = path.join(root, 'apps', 'web', 'node_modules');
  const rootPresent = fs.existsSync(rootMods);
  return {
    present: rootPresent,
    root: rootPresent,
    web: fs.existsSync(webMods),
    why: rootPresent ? null : `${rootMods} does not exist — run npm ci`,
  };
}

export function resolvable(root, specifier) {
  const probe = spawnSync(
    process.execPath,
    ['-e', `require.resolve(${JSON.stringify(specifier)}, { paths: [${JSON.stringify(root)}, ${JSON.stringify(path.join(root, 'apps', 'web'))}] }); process.stdout.write("ok")`],
    { encoding: 'utf8', timeout: 30_000, cwd: root },
  );
  return {
    present: probe.status === 0 && probe.stdout.trim() === 'ok',
    why: probe.status === 0 ? null : `cannot resolve ${specifier} from ${root}`,
  };
}

function tcpReachable(host, port, timeoutMs = 4000) {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `const net=require('node:net');const s=net.connect(${port},${JSON.stringify(host)});`
      + `s.setTimeout(${timeoutMs});`
      + `s.on('connect',()=>{s.destroy();process.stdout.write('ok');process.exit(0)});`
      + `s.on('timeout',()=>{s.destroy();process.stdout.write('timeout');process.exit(1)});`
      + `s.on('error',(e)=>{process.stdout.write(String(e.code||e.message));process.exit(1)});`,
    ],
    { encoding: 'utf8', timeout: timeoutMs + 5000 },
  );
  return { ok: probe.status === 0, detail: probe.stdout.trim() || 'unknown' };
}

/** A PostgreSQL the stage may actually use. Requires a URL AND a live socket. */
export function postgres() {
  const url = process.env.DATABASE_URL;
  if (!url) return { present: false, why: 'DATABASE_URL is not set' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { present: false, why: `DATABASE_URL is not a URL: ${url.slice(0, 40)}` };
  }
  const host = parsed.hostname || '127.0.0.1';
  const port = Number(parsed.port || 5432);
  const reach = tcpReachable(host, port);
  if (!reach.ok) return { present: false, why: `no TCP connection to ${host}:${port} (${reach.detail})`, url: `${parsed.protocol}//${host}:${port}` };
  return { present: true, url: `${parsed.protocol}//${host}:${port}${parsed.pathname}`, direct: process.env.DIRECT_URL ?? null };
}

/** A live application server the HTTP courts can talk to. */
export function appServer() {
  const base = process.env.CANA_VISUAL_BASE_URL ?? process.env.CANA_APP_BASE_URL ?? 'http://127.0.0.1:3000';
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    return { present: false, why: `not a URL: ${base}` };
  }
  const reach = tcpReachable(parsed.hostname, Number(parsed.port || 80), 3000);
  return reach.ok
    ? { present: true, baseUrl: base }
    : { present: false, why: `nothing is listening on ${parsed.hostname}:${parsed.port || 80} (${reach.detail})`, baseUrl: base };
}

/** A Chromium/headless-shell binary the rendered visual court can drive over CDP. */
export function chromium() {
  const explicit = process.env.CANA_CHROMIUM;
  if (explicit && fs.existsSync(explicit)) return { present: true, binary: explicit, source: 'CANA_CHROMIUM' };
  if (explicit) return { present: false, why: `CANA_CHROMIUM=${explicit} does not exist` };
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME ?? '/root', '.cache', 'ms-playwright'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      for (const rel of [
        path.join('chrome-linux', 'headless_shell'),
        path.join('chrome-linux', 'chrome'),
        path.join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
      ]) {
        const candidate = path.join(root, entry, rel);
        if (fs.existsSync(candidate)) return { present: true, binary: candidate, source: root };
      }
    }
  }
  return { present: false, why: 'no Chromium/headless_shell found (set CANA_CHROMIUM or run npx playwright install chromium)' };
}

export function probeAll(root) {
  return {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    git: which('git'),
    python3: which('python3'),
    docker: dockerUsable(),
    nodeModules: nodeModules(root),
    typescript: resolvable(root, 'typescript/package.json'),
    eslint: resolvable(root, 'eslint/package.json'),
    prisma: resolvable(root, 'prisma/package.json'),
    next: resolvable(root, 'next/package.json'),
    playwright: resolvable(root, 'playwright/package.json'),
    postgres: postgres(),
    appServer: appServer(),
    chromium: chromium(),
  };
}
