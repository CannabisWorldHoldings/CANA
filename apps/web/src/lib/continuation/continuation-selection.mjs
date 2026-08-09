import { TRIGGER_STATES, TRIGGER_TYPES } from './continuation-core.mjs';

function interleaveBounded(primary, reactive, limit) {
  const selected = [];
  for (let index = 0; selected.length < limit; index += 1) {
    let advanced = false;
    if (primary[index]) {
      selected.push(primary[index]);
      advanced = true;
    }
    if (selected.length < limit && reactive[index]) {
      selected.push(reactive[index]);
      advanced = true;
    }
    if (!advanced) break;
  }
  return selected;
}

/**
 * Select bounded work without allowing passive reactive rows to hide due or
 * expired time-based work. Reactive events and conditions enter the candidate
 * set only when the wake supplies their evidence; dependencies remain eligible
 * for durable-parent evaluation. Interleaving reserves progress for both work
 * classes when both have a backlog.
 */
export async function selectTickCandidates(
  prisma,
  { conditionResults, events, limit, now },
) {
  const eventKeys = [...events];
  const conditionRefs = [...conditionResults.keys()];
  const reactiveKinds = [
    { triggerType: TRIGGER_TYPES.DEPENDENCY },
    ...(eventKeys.length > 0
      ? [{ triggerType: TRIGGER_TYPES.EVENT, eventKey: { in: eventKeys } }]
      : []),
    ...(conditionRefs.length > 0
      ? [{ triggerType: TRIGGER_TYPES.CONDITION_WATCH, conditionRef: { in: conditionRefs } }]
      : []),
  ];

  const [timeBased, reactive] = await Promise.all([
    prisma.continuationTrigger.findMany({
      where: {
        status: TRIGGER_STATES.ARMED,
        OR: [
          { expiresAt: { lte: now } },
          { nextEligibleAt: { lte: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),
    prisma.continuationTrigger.findMany({
      where: {
        status: TRIGGER_STATES.ARMED,
        expiresAt: { gt: now },
        nextEligibleAt: null,
        OR: reactiveKinds,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),
  ]);

  return interleaveBounded(timeBased, reactive, limit);
}
