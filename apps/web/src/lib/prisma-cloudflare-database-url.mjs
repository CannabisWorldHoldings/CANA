const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

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

  if (
    !LOOPBACK_HOSTS.has(url.hostname)
    && (
      url.searchParams.get('sslmode') !== 'require'
      || url.searchParams.get('sslaccept') !== 'strict'
    )
  ) {
    throw new Error('CLOUDFLARE_DATABASE_URL_STRICT_TLS_REQUIRED');
  }

  return value;
}
