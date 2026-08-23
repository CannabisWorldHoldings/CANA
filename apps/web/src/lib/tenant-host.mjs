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

export function tenantDomainForRequestHostname(hostname) {
  return TENANT_ALIASES[hostname] || hostname;
}

/**
 * Brand routing uses the internal canonical tenant path while public Reality
 * decisions are intentionally scoped to the public ORDERWEEDDC origin. Keep
 * those identities separate at the server boundary so a host rewrite never
 * makes verified public claims disappear from the customer projection.
 */
export function realityProjectionTenantForRouteDomain(routeDomain) {
  return tenantDomainForRequestHostname(routeDomain) === CANONICAL_TENANT_DOMAIN
    ? CANONICAL_PUBLIC_HOSTNAME
    : routeDomain;
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
