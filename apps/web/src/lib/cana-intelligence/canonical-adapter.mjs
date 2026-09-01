import { assert, deepFreeze } from './core.mjs';

/**
 * Adapter boundary into canonical CANA. The kernel NEVER owns truth, auth, or DB state.
 * The host repository must provide these functions from its existing Prisma/auth/reality layers.
 */
export function createCanonicalCanaAdapter(impl) {
  const required = [
    'loadObservations', 'appendObservation', 'loadIntentEvents', 'loadVerifiedSupply',
    'resolveVerifiedPrincipal', 'persistReceipt', 'persistLesson', 'persistPrediction', 'persistExperiment',
  ];
  for (const key of required) assert(typeof impl[key] === 'function', `canonical adapter missing ${key}`, 'CANONICAL_ADAPTER_INCOMPLETE');
  return deepFreeze({ ...impl, authority: 'CANONICAL_CANA_ONLY', ownsTruthStore: false, ownsAuth: false });
}
