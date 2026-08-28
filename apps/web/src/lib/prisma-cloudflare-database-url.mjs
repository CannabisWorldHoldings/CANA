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

  for (const key of url.searchParams.keys()) {
    const normalizedKey = key.toLowerCase();
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
      url.searchParams.getAll('sslmode').length !== 1
      || url.searchParams.get('sslmode') !== 'require'
      || url.searchParams.getAll('sslaccept').length !== 1
      || url.searchParams.get('sslaccept') !== 'strict'
    )
  ) {
    throw new Error('CLOUDFLARE_DATABASE_URL_STRICT_TLS_REQUIRED');
  }

  if (LOOPBACK_HOSTS.has(url.hostname)) return value;

  // The owner-facing Neon URL contract uses require + strict. Normalize that
  // declaration to the effective pg driver mode whose current and announced
  // future semantics both verify the CA and server identity.
  url.searchParams.delete('sslaccept');
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
