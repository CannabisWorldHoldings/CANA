import 'server-only';

import { assertAdmin } from '../auth/session';
import { prisma } from '../prisma';
import { createCanonicalCanaAdapter } from './canonical-adapter.mjs';
import { createCanonicalWeldHost } from './canonical-host.mjs';
import { createCanonicalEvidenceAdapter } from './receipts.mjs';
import { createSiteCortexAdapter } from './site-cortex.mjs';
import { CANONICAL_TENANT_DOMAIN } from '../tenant-host.mjs';

export function createOwnerCanaIntelligenceAdapters() {
  const canonicalHost = createCanonicalWeldHost({
    prisma,
    assertAdmin,
    tenant: CANONICAL_TENANT_DOMAIN,
  });
  return Object.freeze({
    tenant: CANONICAL_TENANT_DOMAIN,
    intelligence: createCanonicalCanaAdapter(canonicalHost),
    evidence: createCanonicalEvidenceAdapter(canonicalHost),
    site: createSiteCortexAdapter(canonicalHost),
    resolveOwnerPrincipalReceipt: () => canonicalHost.resolveVerifiedPrincipalReceipt(),
  });
}
