import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXPECTED_KIND = 'repository-postgis-h3';
const REQUIRED_EXTENSIONS = Object.freeze(['postgis', 'h3', 'h3_postgis']);
const REQUIRED_FUNCTIONS = Object.freeze({
  h3: ['h3_lat_lng_to_cell'],
  postgis: ['st_contains', 'st_distance'],
});
const MANAGED_UNKNOWNS = Object.freeze({
  acceptable_use: 'UNKNOWN',
  backup_restore: 'UNKNOWN',
  h3_extension: 'UNKNOWN',
  region: 'UNKNOWN',
  rollback: 'UNKNOWN',
});

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function blocked(code, extras = {}) {
  return { code, verdict: 'BLOCKED', ...extras };
}

function boundaryFailure(env) {
  if (env.PRODUCTION_EFFECTS !== '0') return 'C3_PRODUCTION_EFFECTS_ZERO_REQUIRED';
  for (const key of ['C3_DEPLOY', 'C3_PRODUCTION_MUTATION', 'C3_MUTATE_TARGET']) {
    if (present(env[key])) return 'C3_PRODUCTION_MUTATION_REFUSED';
  }
  if (present(env.C3_OPERATION) && env.C3_OPERATION !== 'READ_ONLY_VERIFICATION') {
    return 'C3_OPERATION_REFUSED';
  }
  return null;
}

export function classifyDatabaseUrl(databaseUrl) {
  if (!present(databaseUrl)) return 'ABSENT';
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return 'UNCLASSIFIED';
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return 'UNCLASSIFIED';
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '127.0.0.1' || host === '::ffff:127.0.0.1') {
    return 'LOOPBACK';
  }
  return host ? 'NON_LOOPBACK' : 'UNCLASSIFIED';
}

function canonicalOwnerReceiptShape(receipt) {
  return Boolean(receipt && receipt.schema === 'cana.owner-authorization/1');
}

function authorizeRemoteProbe({ receipt, databaseUrl, admitAuthorization }) {
  if (!canonicalOwnerReceiptShape(receipt) || typeof admitAuthorization !== 'function') return false;
  const targetDigest = crypto.createHash('sha256').update(databaseUrl).digest('hex');
  try {
    const admission = admitAuthorization({ receipt, targetDigest });
    return Boolean(
      admission
        && Object.keys(admission).sort().join(',') === 'code,ok'
        && admission.ok === true
        && admission.code === 'OWNER_GRANT_ADMITTED',
    );
  } catch {
    return false;
  }
}

function extensionVersion(observed, inventory, extension) {
  const value = observed?.extensions?.[inventory]?.[extension];
  return typeof value === 'string' && value.trim().length > 0;
}

function requiredFunctionsPresent(observed, family) {
  const functions = new Set(
    Array.isArray(observed?.functions?.[family])
      ? observed.functions[family].map((value) => String(value).toLowerCase())
      : [],
  );
  return REQUIRED_FUNCTIONS[family].every((name) => functions.has(name));
}

function validateLocalObservation(observed) {
  if (String(observed?.engine ?? '').toLowerCase() === 'sqlite') return 'C3_SQLITE_REJECTED';
  if (String(observed?.engine ?? '').toLowerCase() !== 'postgresql') return 'C3_POSTGRESQL_REQUIRED';
  if (!present(observed?.server_identity)) return 'C3_SERVER_IDENTITY_REQUIRED';
  if (!present(observed?.tls?.mode) || observed?.tls?.verified !== true) return 'C3_TLS_VERIFICATION_REQUIRED';
  if (!extensionVersion(observed, 'available', 'postgis') || !extensionVersion(observed, 'installed', 'postgis')) {
    return 'C3_POSTGIS_EXTENSION_REQUIRED';
  }
  if (REQUIRED_EXTENSIONS.slice(1).some((extension) => (
    !extensionVersion(observed, 'available', extension)
    || !extensionVersion(observed, 'installed', extension)
  ))) return 'C3_H3_EXTENSION_REQUIRED';
  if (!requiredFunctionsPresent(observed, 'postgis')) return 'C3_POSTGIS_FUNCTION_REQUIRED';
  if (!requiredFunctionsPresent(observed, 'h3')) return 'C3_H3_FUNCTION_REQUIRED';
  if (observed?.prisma?.connected !== true) return 'C3_PRISMA_CONNECTIVITY_REQUIRED';
  if (observed?.read_only?.enforced !== true || observed?.read_only?.write_capable !== false) {
    return 'C3_READ_ONLY_ENFORCEMENT_REQUIRED';
  }
  return null;
}

export function evaluateLocalC3({
  env = {}, databaseUrl, expectedKind, authorizationReceipt = null, admitAuthorization, probe,
} = {}) {
  const boundary = boundaryFailure(env);
  if (boundary) return blocked(boundary, { mode: 'LOCAL_DISPOSABLE' });
  if (expectedKind !== EXPECTED_KIND) return blocked('C3_EXPECTED_KIND_REQUIRED', { mode: 'LOCAL_DISPOSABLE' });
  const urlClassification = classifyDatabaseUrl(databaseUrl);
  if (urlClassification === 'ABSENT') return blocked('C3_DATABASE_URL_REQUIRED', { mode: 'LOCAL_DISPOSABLE' });
  if (urlClassification === 'UNCLASSIFIED') return blocked('C3_DATABASE_URL_UNCLASSIFIED', { mode: 'LOCAL_DISPOSABLE' });
  const remoteAuthorized = urlClassification === 'NON_LOOPBACK' && authorizeRemoteProbe({
    receipt: authorizationReceipt,
    databaseUrl,
    admitAuthorization,
  });
  if (urlClassification === 'NON_LOOPBACK' && !remoteAuthorized) {
    return blocked('C3_NON_LOOPBACK_AUTHORIZATION_REQUIRED', { mode: 'LOCAL_DISPOSABLE' });
  }
  if (typeof probe !== 'function') return blocked('C3_LOCAL_PROBE_REQUIRED', { mode: 'LOCAL_DISPOSABLE' });

  let observed;
  try {
    observed = probe({ databaseUrl, expectedKind, readOnly: true });
  } catch {
    return blocked('C3_LOCAL_PROBE_FAILED', { mode: 'LOCAL_DISPOSABLE' });
  }
  const failure = validateLocalObservation(observed);
  if (failure) return blocked(failure, { mode: 'LOCAL_DISPOSABLE' });
  return {
    code: remoteAuthorized ? 'C3_MANAGED_READ_ONLY_CAPABILITY_OBSERVED' : 'C3_LOCAL_REFERENCE_CONFIRMED',
    datastore: 'POSTGRESQL_POSTGIS_H3',
    mode: remoteAuthorized ? 'MANAGED_READ_ONLY_OBSERVATION' : 'LOCAL_DISPOSABLE',
    verdict: remoteAuthorized ? 'MANAGED_READ_ONLY_CAPABILITY_OBSERVED' : 'LOCAL_REFERENCE_GREEN',
  };
}

export function evaluateManagedC3({ transports = [] } = {}) {
  if (transports.length > 1) {
    return blocked('C3_TRANSPORT_CONFLICT', {
      mode: 'MANAGED_TARGET',
      probe: { attempted: false, reason: 'TRANSPORT_CONFLICT' },
      transport: 'UNDECIDED',
      unknowns: { ...MANAGED_UNKNOWNS },
    });
  }
  if (transports.some((transport) => !['HYPERDRIVE_PG', 'NEON_SERVERLESS'].includes(transport))) {
    return blocked('C3_TRANSPORT_INVALID', {
      mode: 'MANAGED_TARGET',
      probe: { attempted: false, reason: 'TRANSPORT_INVALID' },
      transport: 'UNDECIDED',
      unknowns: { ...MANAGED_UNKNOWNS },
    });
  }
  return {
    code: 'C3_MANAGED_TARGET_OWNER_EVIDENCE_REQUIRED',
    mode: 'MANAGED_TARGET',
    probe: { attempted: false, reason: 'OWNER_CREDENTIALS_AND_EXTENSION_PROOF_REQUIRED' },
    transport: 'UNDECIDED',
    unknowns: { ...MANAGED_UNKNOWNS },
    verdict: 'BLOCKED_OWNER_CREDENTIALS_AND_EXTENSION_PROOF',
  };
}

export function runC3DatabaseTargetCourt({
  env = process.env,
  databaseUrl = null,
  expectedKind = null,
  authorizationReceipt = null,
  admitAuthorization,
  localProbe,
  transports = [],
} = {}) {
  return canonicalize({
    court: 'cana.c3-database-target/v2',
    database_url: {
      classification: classifyDatabaseUrl(databaseUrl),
      supplied: present(databaseUrl),
    },
    expected_kind: expectedKind === EXPECTED_KIND ? EXPECTED_KIND : 'UNSATISFIED',
    local: evaluateLocalC3({
      env, databaseUrl, expectedKind, authorizationReceipt, admitAuthorization, probe: localProbe,
    }),
    managed: evaluateManagedC3({ transports }),
    managed_target_certified: false,
    production_effects: env.PRODUCTION_EFFECTS === '0' ? 0 : 'REQUIRED_ZERO',
  });
}

export function serializeC3DatabaseTargetReceipt(receipt) {
  return `${JSON.stringify(canonicalize(receipt), null, 2)}\n`;
}

export function parseC3DatabaseTargetArgs(argv) {
  const parsed = {
    authorizationReceiptPath: null,
    databaseUrl: null,
    expectedKind: null,
    out: null,
    transports: [],
  };
  const values = new Set(['--authorization-receipt', '--database-url', '--expected-kind', '--out', '--transport']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!values.has(token)) throw new Error('C3_CLI_UNKNOWN_ARGUMENT');
    const value = argv[index + 1];
    if (!present(value)) throw new Error('C3_CLI_VALUE_REQUIRED');
    index += 1;
    if (token === '--authorization-receipt') parsed.authorizationReceiptPath = value;
    if (token === '--database-url') parsed.databaseUrl = value;
    if (token === '--expected-kind') parsed.expectedKind = value;
    if (token === '--out') parsed.out = value;
    if (token === '--transport') parsed.transports.push(value);
  }
  if (parsed.expectedKind !== EXPECTED_KIND) throw new Error('C3_EXPECTED_KIND_REQUIRED');
  if (parsed.transports.length > 1) throw new Error('C3_TRANSPORT_CONFLICT');
  if (parsed.transports.some((transport) => !['HYPERDRIVE_PG', 'NEON_SERVERLESS'].includes(transport))) {
    throw new Error('C3_TRANSPORT_INVALID');
  }
  return parsed;
}

function readAuthorizationReceipt(receiptPath, readFile) {
  try {
    const receipt = JSON.parse(readFile(receiptPath, 'utf8'));
    if (!canonicalOwnerReceiptShape(receipt)) throw new Error('invalid authorization receipt');
    return receipt;
  } catch {
    throw new Error('C3_AUTHORIZATION_RECEIPT_INVALID');
  }
}

export function runC3DatabaseTargetCli({
  argv = process.argv.slice(2), env = process.env, localProbe, admitAuthorization,
  readFile = fs.readFileSync, writeFile = fs.writeFileSync,
} = {}) {
  const args = parseC3DatabaseTargetArgs(argv);
  const authorizationReceipt = args.authorizationReceiptPath
    ? readAuthorizationReceipt(args.authorizationReceiptPath, readFile)
    : null;
  const receipt = runC3DatabaseTargetCourt({
    authorizationReceipt,
    admitAuthorization,
    databaseUrl: args.databaseUrl,
    env,
    expectedKind: args.expectedKind,
    localProbe,
    transports: args.transports,
  });
  if (args.out) writeFile(args.out, serializeC3DatabaseTargetReceipt(receipt), { encoding: 'utf8', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receipt = runC3DatabaseTargetCli();
    process.stdout.write(serializeC3DatabaseTargetReceipt(receipt));
    if (receipt.local.verdict !== 'LOCAL_REFERENCE_GREEN') process.exitCode = 3;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: String(error?.message ?? error) })}\n`);
    process.exitCode = 3;
  }
}
