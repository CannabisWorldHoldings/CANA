import 'server-only';

import { prisma } from '@/lib/prisma';
import { resolveRuntimeExperienceManifest } from './runtime-manifest.mjs';

export async function loadRuntimeExperienceManifest({
  tenant,
  journey,
}: {
  tenant: string;
  journey: 'HOME' | 'SEARCH' | 'DELIVERY' | 'DISPENSARIES';
}) {
  return resolveRuntimeExperienceManifest({
    recordStore: prisma.canaIntelligenceRecord,
    receiptStore: prisma.canaEvidenceReceipt,
    tenant,
    journey,
  });
}
