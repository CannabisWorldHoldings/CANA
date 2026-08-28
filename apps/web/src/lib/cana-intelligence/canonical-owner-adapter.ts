import 'server-only';

import { assertAdmin } from '../auth/session';
import { prisma } from '../prisma';
import { createCanonicalCanaAdapter } from './canonical-adapter.mjs';
import { createCanonicalWeldHost } from './canonical-host.mjs';
import { createCanonicalEvidenceAdapter } from './receipts.mjs';

export function createOwnerCanaIntelligenceAdapters(tenant: string) {
  if (!tenant.trim()) throw new Error('CANA_HOST_TENANT_REQUIRED');
  const canonicalHost = createCanonicalWeldHost({ prisma, assertAdmin, tenant });
  return Object.freeze({
    intelligence: createCanonicalCanaAdapter(canonicalHost),
    evidence: createCanonicalEvidenceAdapter(canonicalHost),
    resolveOwnerPrincipalReceipt: () => canonicalHost.resolveVerifiedPrincipalReceipt(),
  });
}
