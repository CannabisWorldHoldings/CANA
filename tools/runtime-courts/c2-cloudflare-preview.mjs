/**
 * C2 is an evidence court, not a deployment tool.
 *
 * The default invocation stops after proving the exact source, version pins and
 * no-effect boundary.  A later, explicitly enabled task may use the exported
 * runner to make a disposable source copy and run a local workerd preview.
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const C2_SCHEMA_VERSION = 1;
export const EXACT_NEXT_VERSION = '16.3.0-canary.6';
export const EXACT_OPENNEXT_VERSION = '1.20.2';
// A test pin, deliberately not an assertion that this version is production approved.
export const EXACT_WRANGLER_VERSION = '4.86.0';
export const COMPATIBILITY_DATE = '2024-09-23';
export const VERDICTS = Object.freeze([
  'COMPATIBLE_LOCAL_PREVIEW',
  'BLOCKED_CANARY_INCOMPATIBILITY',
  'ENVIRONMENT_MISSING',
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(HERE, '..', '..');
const CREDENTIAL_NAME = /^(?:CLOUDFLARE|CF|WRANGLER)_(?:API|ACCOUNT|ZONE|TOKEN|SECRET|KEY|EMAIL|AUTH)/i;
const FORBIDDEN_FLAGS = new Set([
  '--deploy', '--remote', '--remote-target', '--project', '--project-name',
  '--account-id', '--zone-id', '--api-token', '--api-key', '--binding', '--bindings',
]);
const COPY_EXCLUDES = new Set(['.git', 'node_modules', '.next', '.cana-local', '.env', '.env.local']);

export class C2Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function required(value, name) {
  if (!value) throw new C2Refusal('C2_ARGUMENT_REQUIRED', `${name} is required`);
  return value;
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new C2Refusal('C2_REPOSITORY_IDENTITY_UNAVAILABLE', `cannot resolve Git identity for ${repo}`);
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isHex(value, length) {
  return typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function parseC2Args(argv) {
  const parsed = { executeLocalPreview: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (FORBIDDEN_FLAGS.has(token)) {
      throw new C2Refusal('C2_EXTERNAL_EFFECT_REFUSED', `${token} is forbidden in the C2 court`);
    }
    if (token === '--execute-local-preview') {
      parsed.executeLocalPreview = true;
      continue;
    }
    if (!['--repo', '--expected-sha', '--expected-tree', '--work-dir', '--out', '--opennext', '--wrangler', '--preview-url'].includes(token)) {
      throw new C2Refusal('C2_INVALID_ARGUMENT', `unsupported C2 argument: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new C2Refusal('C2_INVALID_ARGUMENT', `missing value for ${token}`);
    parsed[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return parsed;
}

export function assertNoExternalEffects({ env = process.env, argv = [] } = {}) {
  if (env.PRODUCTION_EFFECTS !== '0') {
    throw new C2Refusal('C2_PRODUCTION_EFFECTS_REQUIRED', 'PRODUCTION_EFFECTS must equal literal 0');
  }
  for (const [name, value] of Object.entries(env)) {
    if (value && CREDENTIAL_NAME.test(name)) {
      throw new C2Refusal('C2_EXTERNAL_EFFECT_REFUSED', `credential-shaped environment variable refused: ${name}`);
    }
  }
  for (const token of argv) {
    if (FORBIDDEN_FLAGS.has(token)) throw new C2Refusal('C2_EXTERNAL_EFFECT_REFUSED', `${token} is forbidden in the C2 court`);
  }
  return { productionEffects: 0, cloudflareEffects: 0 };
}

export function assertLoopbackPreviewUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new C2Refusal('C2_PREVIEW_URL_REFUSED', 'preview URL must be a valid loopback http(s) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
    throw new C2Refusal('C2_PREVIEW_URL_REFUSED', 'preview URL must resolve to localhost, 127.0.0.1, or ::1');
  }
  return url.toString();
}

export function assertIsolatedWorkDirectory(repo, workDir) {
  const repository = path.resolve(required(repo, '--repo'));
  const suppliedPath = path.resolve(required(workDir, '--work-dir'));
  const repoReal = fs.realpathSync(repository);
  const parent = fs.realpathSync(path.dirname(suppliedPath));
  const supplied = fs.existsSync(suppliedPath)
    ? fs.realpathSync(suppliedPath)
    : path.join(parent, path.basename(suppliedPath));
  if (supplied === repoReal || supplied.startsWith(`${repoReal}${path.sep}`)) {
    throw new C2Refusal('C2_WORKDIR_NOT_ISOLATED', 'work directory must be outside the production source tree');
  }
  if (!path.basename(suppliedPath).startsWith('c2-opennext-')) {
    throw new C2Refusal('C2_WORKDIR_NOT_ISOLATED', 'work directory must use the task-owned c2-opennext-* prefix');
  }
  if (!fs.existsSync(supplied)) {
    throw new C2Refusal('C2_WORKDIR_NOT_ISOLATED', 'work directory must be created explicitly before the court runs');
  }
  const stat = fs.lstatSync(suppliedPath);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(supplied).length !== 0) {
    throw new C2Refusal('C2_WORKDIR_NOT_ISOLATED', 'work directory must be an empty, non-symlink task-owned directory');
  }
  return supplied;
}

export function readExactSource({ repo, expectedSha, expectedTree }) {
  const source = path.resolve(required(repo, '--repo'));
  const sha = git(source, ['rev-parse', 'HEAD']);
  const tree = git(source, ['rev-parse', 'HEAD^{tree}']);
  if (!isHex(expectedSha, 40) || sha !== expectedSha) {
    throw new C2Refusal('C2_SOURCE_SHA_MISMATCH', 'candidate SHA does not match the out-of-band expected SHA');
  }
  if (!isHex(expectedTree, 40) || tree !== expectedTree) {
    throw new C2Refusal('C2_SOURCE_TREE_MISMATCH', 'candidate tree does not match the out-of-band expected tree');
  }
  const status = git(source, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) {
    throw new C2Refusal('C2_SOURCE_NOT_CLEAN', 'candidate source must be clean before the C2 court copies it');
  }
  const webPackagePath = path.join(source, 'apps', 'web', 'package.json');
  let webPackage;
  try {
    webPackage = JSON.parse(fs.readFileSync(webPackagePath, 'utf8'));
  } catch {
    throw new C2Refusal('C2_WEB_PACKAGE_UNAVAILABLE', 'apps/web/package.json is required');
  }
  if (webPackage.dependencies?.next !== EXACT_NEXT_VERSION || webPackage.devDependencies?.['eslint-config-next'] !== EXACT_NEXT_VERSION) {
    throw new C2Refusal('C2_EXACT_VERSION_DRIFT', `C2 is pinned to Next and eslint-config-next ${EXACT_NEXT_VERSION}`);
  }
  const openNextConfigPath = path.join(source, 'apps', 'web', 'open-next.config.ts');
  if (!fs.existsSync(openNextConfigPath) || !fs.lstatSync(openNextConfigPath).isFile() || fs.lstatSync(openNextConfigPath).isSymbolicLink()) {
    throw new C2Refusal('C2_OPENNEXT_CONFIG_REQUIRED', 'a committed non-symlink open-next.config.ts is required');
  }
  return { repository: source, sha, tree, nextVersion: webPackage.dependencies.next };
}

export function assertExactToolPins({ opennext = EXACT_OPENNEXT_VERSION, wrangler = EXACT_WRANGLER_VERSION } = {}) {
  if (opennext !== EXACT_OPENNEXT_VERSION || wrangler !== EXACT_WRANGLER_VERSION) {
    throw new C2Refusal('C2_EXACT_VERSION_DRIFT', `expected @opennextjs/cloudflare@${EXACT_OPENNEXT_VERSION} and wrangler@${EXACT_WRANGLER_VERSION}`);
  }
  return { opennext, wrangler };
}

export function buildC2Plan({ repo, expectedSha, expectedTree, workDir, opennext, wrangler, previewUrl, env = process.env, argv = [] }) {
  const effects = assertNoExternalEffects({ env, argv });
  const source = readExactSource({ repo, expectedSha, expectedTree });
  const isolatedWorkDir = assertIsolatedWorkDirectory(source.repository, workDir);
  const pins = assertExactToolPins({ opennext, wrangler });
  const localPreviewUrl = assertLoopbackPreviewUrl(previewUrl ?? 'http://127.0.0.1:8787');
  const copyDir = path.join(isolatedWorkDir, 'source');
  const appDir = path.join(copyDir, 'apps', 'web');
  return {
    source,
    effects,
    pins,
    workDir: isolatedWorkDir,
    copyDir,
    appDir,
    previewUrl: localPreviewUrl,
    compatibilityDate: COMPATIBILITY_DATE,
    commands: [
      ['npm', ['install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', `@opennextjs/cloudflare@${pins.opennext}`, `wrangler@${pins.wrangler}`]],
      ['npm', ['run', 'prisma:generate', '--workspace', 'apps/web']],
      ['node', ['../../node_modules/@opennextjs/cloudflare/dist/cli/index.js', 'build']],
      ['node', ['../../node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787']],
    ],
  };
}

function copyCandidate(plan) {
  fs.cpSync(plan.source.repository, plan.copyDir, {
    recursive: true,
    dereference: false,
    filter: (from) => {
      const name = path.basename(from);
      return !COPY_EXCLUDES.has(name) && !name.startsWith('.env.');
    },
  });
  fs.writeFileSync(path.join(plan.appDir, 'wrangler.jsonc'), `${JSON.stringify({
    name: 'c2-local-evidence-only', main: '.open-next/worker.js', compatibility_date: plan.compatibilityDate,
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
    assets: { directory: '.open-next/assets', binding: 'ASSETS' },
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export function classifyC2Results(results = {}) {
  const attempted = Boolean(results.attempted);
  const installPassed = results.install?.ok === true;
  const prismaGenerated = results.prismaGenerate?.ok === true;
  const allRoutesPassed = Array.isArray(results.routes) && results.routes.length > 0 && results.routes.every((route) => route.ok === true);
  const buildPassed = results.build?.ok === true;
  const previewPassed = results.preview?.ok === true;
  const verdict = !attempted
    ? 'ENVIRONMENT_MISSING'
    : !installPassed || !prismaGenerated
      ? 'ENVIRONMENT_MISSING'
      : buildPassed && previewPassed && allRoutesPassed
      ? 'COMPATIBLE_LOCAL_PREVIEW'
      : 'BLOCKED_CANARY_INCOMPATIBILITY';
  const blockerCode = !attempted
    ? 'C2_LOCAL_EXECUTION_NOT_ATTEMPTED'
    : !installPassed
      ? (results.install?.code ?? 'C2_DEPENDENCY_INSTALL_FAILED')
      : !prismaGenerated
        ? (results.prismaGenerate?.code ?? 'C2_PRISMA_GENERATE_FAILED')
      : !buildPassed
        ? (results.build?.code ?? 'C2_OPENNEXT_BUILD_FAILED')
        : !previewPassed
          ? (results.preview?.code ?? 'C2_LOCAL_WORKERD_FAILED')
          : !allRoutesPassed ? 'C2_ROUTE_PARITY_FAILED' : null;
  return {
    verdict,
    executionStatus: !attempted
      ? 'BLOCKED_NOT_EXECUTED_BY_DEFAULT'
      : !installPassed || !prismaGenerated
        ? 'BLOCKED_ENVIRONMENT_SETUP'
        : verdict === 'COMPATIBLE_LOCAL_PREVIEW' ? 'LOCAL_PREVIEW_OBSERVED' : 'BLOCKED_LOCAL_PREVIEW_FAILURE',
    blockerCode,
    productionReady: false,
    stableNextSecurityPatchedRecourt: 'OPEN',
  };
}

export function createC2Receipt(plan, results = {}) {
  const classification = classifyC2Results(results);
  const receipt = {
    schemaVersion: C2_SCHEMA_VERSION,
    kind: 'c2-cloudflare-opennext-local-compatibility-court',
    candidate: { sha: plan.source.sha, tree: plan.source.tree, nextVersion: plan.source.nextVersion },
    toolPins: { opennext: plan.pins.opennext, wrangler: plan.pins.wrangler },
    localOnly: { compatibilityDate: plan.compatibilityDate, previewUrl: plan.previewUrl, nodejsCompat: true },
    effects: { productionEffects: 0, cloudflareEffects: 0 },
    execution: results,
    classification,
    evidenceDigest: sha256(canonicalJson({ candidate: plan.source, pins: plan.pins, results, classification })),
  };
  return receipt;
}

export function writeC2Receipt(outFile, receipt) {
  const output = path.resolve(required(outFile, '--out'));
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return output;
}

function commandFailureCode(error) {
  const diagnostic = `${error?.code ?? ''}\n${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`;
  if (/\bERESOLVE\b/.test(diagnostic)) return 'C2_NPM_DEPENDENCY_CONFLICT';
  if (/\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT)\b|network request failed/i.test(diagnostic)) {
    return 'C2_DEPENDENCY_FETCH_UNAVAILABLE';
  }
  if (/Prisma Client did not initialize|\.prisma\/client|Cannot find module ['"]@prisma\/client/i.test(diagnostic)) {
    return 'C2_PRISMA_CLIENT_UNAVAILABLE';
  }
  if (/unsupported Next(?:\.js)? version|peer next@/i.test(diagnostic)) return 'C2_OPENNEXT_NEXT_VERSION_UNSUPPORTED';
  if (/No `open-next\.config\.ts` file was found|open-next\.config\.ts.*required/i.test(diagnostic)) {
    return 'C2_OPENNEXT_CONFIG_REQUIRED';
  }
  if (/BUILD_DATABASE_[A-Z_]+|DATABASE_(?:MIGRATION_FAILED|NOT_READY)/.test(diagnostic)) {
    return 'C2_BUILD_DATABASE_GATE_FAILED';
  }
  if (/Module not found|ERR_MODULE_NOT_FOUND/.test(diagnostic)) return 'C2_BUILD_MODULE_NOT_FOUND';
  return 'C2_COMMAND_FAILED';
}

function run(command, args, { cwd, env }) {
  try {
    execFileSync(command, args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, command, args };
  } catch (error) {
    return {
      ok: false,
      command,
      args,
      exitCode: error.status ?? null,
      code: commandFailureCode(error),
    };
  }
}

function compressedWorkerSize(appDir) {
  const worker = path.join(appDir, '.open-next', 'worker.js');
  if (!fs.existsSync(worker)) return null;
  return {
    path: '.open-next/worker.js',
    bytes: fs.statSync(worker).size,
    gzipBytes: Number(execFileSync('gzip', ['-c', worker], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }).length),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchRoute(url, route) {
  try {
    const response = await fetch(new URL(route, url), { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    const expected = route === '/admin'
      ? [200, 302, 303, 307, 401, 403]
      : [200];
    return { route, status: response.status, ok: expected.includes(response.status) };
  } catch (error) {
    return { route, status: null, ok: false, code: 'C2_LOOPBACK_ROUTE_UNREACHABLE', message: error.name };
  }
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3_000),
  ]);
  if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
}

async function runWorkerdPreview(plan, env) {
  const [previewCommand, previewArgs] = plan.commands[3];
  const child = spawn(previewCommand, previewArgs, { cwd: plan.appDir, env, stdio: ['ignore', 'ignore', 'ignore'] });
  const routes = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) break;
      const health = await fetchRoute(plan.previewUrl, '/api/health');
      if (health.ok) {
        routes.push(health);
        ready = true;
        break;
      }
      await delay(200);
    }
    if (!ready) {
      return {
        preview: { ok: false, code: 'C2_LOCAL_WORKERD_NOT_READY', command: [previewCommand, previewArgs], exitCode: child.exitCode },
        routes,
      };
    }
    for (const route of ['/api/release', '/', '/admin']) routes.push(await fetchRoute(plan.previewUrl, route));
    return { preview: { ok: true, command: [previewCommand, previewArgs] }, routes };
  } finally {
    await terminate(child);
  }
}

/**
 * This method is intentionally opt-in.  It is not reached by the normal CLI;
 * Task 15 must supply C2_EXECUTE_LOCAL_PREVIEW=1 after its own custody check.
 */
export async function executeLocalPreview(plan, { env = process.env, executor = run } = {}) {
  if (env.C2_EXECUTE_LOCAL_PREVIEW !== '1') {
    throw new C2Refusal('C2_EXECUTION_NOT_ENABLED', 'set C2_EXECUTE_LOCAL_PREVIEW=1 only for a disposable local evidence run');
  }
  copyCandidate(plan);
  const localEnv = {
    ...env,
    PRODUCTION_EFFECTS: '0',
    CLOUDFLARE_API_TOKEN: undefined,
    CF_API_TOKEN: undefined,
    WRANGLER_API_TOKEN: undefined,
  };
  const [installCommand, prismaGenerateCommand, buildCommand, previewCommand] = plan.commands;
  const install = executor(installCommand[0], installCommand[1], { cwd: plan.appDir, env: localEnv });
  const prismaGenerate = install.ok
    ? executor(prismaGenerateCommand[0], prismaGenerateCommand[1], { cwd: plan.copyDir, env: localEnv })
    : { ok: false, skipped: 'INSTALL_FAILED' };
  const build = prismaGenerate.ok
    ? executor(buildCommand[0], buildCommand[1], { cwd: plan.appDir, env: localEnv })
    : { ok: false, skipped: 'PRISMA_GENERATE_FAILED' };
  if (!build.ok) return { attempted: true, install, prismaGenerate, build, workerSize: null, preview: { ok: false, skipped: 'BUILD_FAILED' }, routes: [] };
  const workerSize = compressedWorkerSize(plan.appDir);
  if (!workerSize) return { attempted: true, install, prismaGenerate, build, workerSize: null, preview: { ok: false, code: 'C2_WORKER_ARTIFACT_MISSING', command: previewCommand }, routes: [] };
  const { preview, routes } = await runWorkerdPreview(plan, localEnv);
  return { attempted: true, install, prismaGenerate, build, workerSize, preview, routes };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseC2Args(argv);
  const effectiveEnv = { ...env };
  const plan = buildC2Plan({ ...args, env: effectiveEnv, argv });
  const results = args.executeLocalPreview ? await executeLocalPreview(plan, { env: effectiveEnv }) : { attempted: false, reason: 'LOCAL_EXECUTION_DISABLED_BY_DEFAULT' };
  const receipt = createC2Receipt(plan, results);
  if (args.out) writeC2Receipt(args.out, receipt);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.code ?? 'C2_UNEXPECTED'}: ${error.message}\n`);
    process.exitCode = 2;
  });
}
