export const CANONICAL_PUBLIC_HOSTNAME = 'orderweeddc.com';
export const CANONICAL_TENANT_DOMAIN = 'orderweeddc.localhost';

const TENANT_ALIASES = Object.freeze({
  [CANONICAL_PUBLIC_HOSTNAME]: CANONICAL_TENANT_DOMAIN,
});

export function isLocalPlatformHostname(hostname) {
  return (
    typeof hostname === 'string' &&
    (hostname === 'localhost' || hostname.endsWith('.localhost'))
  );
}

export function isCanonicalPlatformHostname(hostname) {
  return (
    hostname === CANONICAL_PUBLIC_HOSTNAME ||
    hostname === CANONICAL_TENANT_DOMAIN
  );
}

export function isValidPlatformHost(host) {
  if (!host || typeof host !== 'string') return false;
  const hostname = host.split(':')[0].toLowerCase();
  return isLocalPlatformHostname(hostname) || isCanonicalPlatformHostname(hostname);
}

export function tenantDomainForRequestHostname(hostname) {
  return TENANT_ALIASES[hostname] || hostname;
}

export function originForRequestHost(requestHost) {
  const protocol = isLocalPlatformHostname(requestHost.hostname)
    ? 'http'
    : 'https';
  return new URL(`${protocol}://${requestHost.authority}`);
}

export function canonicalOriginForRequestHost(requestHost) {
  if (isLocalPlatformHostname(requestHost.hostname)) {
    const port = requestHost.port ? `:${requestHost.port}` : '';
    return new URL(`http://${CANONICAL_TENANT_DOMAIN}${port}`);
  }
  return new URL(`https://${CANONICAL_PUBLIC_HOSTNAME}`);
}
