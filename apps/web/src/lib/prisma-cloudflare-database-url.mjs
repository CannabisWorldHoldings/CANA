const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);
const CONNECTION_OVERRIDE_PARAMETERS = new Set([
  'database',
  'host',
  'password',
  'port',
  'user',
]);
const TLS_OVERRIDE_PARAMETERS = new Set([
  'checkserveridentity',
  'rejectunauthorized',
  'uselibpqcompat',
]);

export function assertCloudflareDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('CLOUDFLARE_DATABASE_URL_REQUIRED');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CLOUDFLARE_DATABASE_URL_INVALID');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('CLOUDFLARE_DATABASE_URL_POSTGRESQL_REQUIRED');
  }

  const normalizedParameters = new Map();
  for (const [key, parameterValue] of url.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    const values = normalizedParameters.get(normalizedKey) ?? [];
    values.push(parameterValue);
    normalizedParameters.set(normalizedKey, values);
    if (CONNECTION_OVERRIDE_PARAMETERS.has(normalizedKey)) {
      throw new Error('CLOUDFLARE_DATABASE_URL_CONNECTION_OVERRIDE_FORBIDDEN');
    }
    if (
      TLS_OVERRIDE_PARAMETERS.has(normalizedKey)
      || (
        normalizedKey.startsWith('ssl')
        && normalizedKey !== 'sslmode'
        && normalizedKey !== 'sslaccept'
      )
    ) {
      throw new Error('CLOUDFLARE_DATABASE_URL_TLS_OVERRIDE_FORBIDDEN');
    }
  }

  if (
    !LOOPBACK_HOSTS.has(url.hostname)
    && (
      normalizedParameters.get('sslmode')?.length !== 1
      || normalizedParameters.get('sslmode')?.[0] !== 'require'
      || normalizedParameters.get('sslaccept')?.length !== 1
      || normalizedParameters.get('sslaccept')?.[0] !== 'strict'
    )
  ) {
    throw new Error('CLOUDFLARE_DATABASE_URL_STRICT_TLS_REQUIRED');
  }

  if (LOOPBACK_HOSTS.has(url.hostname)) return value;

  // The owner-facing Neon URL contract uses require + strict. Normalize that
  // declaration to the effective pg driver mode whose current and announced
  // future semantics both verify the CA and server identity.
  for (const key of [...url.searchParams.keys()]) {
    if (['sslmode', 'sslaccept'].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export function assertCloudflareHyperdriveConnection(env) {
  const hyperdrive = env?.HYPERDRIVE;
  if (!hyperdrive || typeof hyperdrive !== 'object') {
    throw new Error('C3_HYPERDRIVE_BINDING_REQUIRED');
  }

  const connectionString = hyperdrive.connectionString;
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('C3_HYPERDRIVE_CONNECTION_STRING_REQUIRED');
  }

  try {
    return assertCloudflareDatabaseUrl(connectionString);
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_DATABASE_URL_INVALID') {
      throw new Error('C3_HYPERDRIVE_CONNECTION_STRING_INVALID');
    }
    if (error?.message === 'CLOUDFLARE_DATABASE_URL_POSTGRESQL_REQUIRED') {
      throw new Error('C3_HYPERDRIVE_POSTGRESQL_REQUIRED');
    }
    throw error;
  }
}

export function resolveCloudflarePrismaConnection(env) {
  return Object.freeze({
    source: 'HYPERDRIVE',
    connectionString: assertCloudflareHyperdriveConnection(env),
  });
}
