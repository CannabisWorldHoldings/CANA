import { GENESIS_HASH, receiptHash } from './continuation-core.mjs';

export async function inSerializableTransaction(prisma, operation, attempt = 0) {
  // Prisma transaction clients cannot open nested transactions. Callers that
  // already hold the serializable boundary may safely reuse this helper.
  if (typeof prisma?.$transaction !== 'function') return operation(prisma);
  try {
    return await prisma.$transaction(operation, {
      isolationLevel: 'Serializable',
      timeout: 10_000,
    });
  } catch (error) {
    if (attempt < 3 && ['P2002', 'P2034'].includes(String(error?.code))) {
      return inSerializableTransaction(prisma, operation, attempt + 1);
    }
    throw error;
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value ?? 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolve consumer authority exclusively from the durable receipt chain.
 * Caller summaries are routing hints only: no field from them grants authority.
 */
export async function loadVerifiedFiredConsumerAuthority(prisma, {
  receiptId,
  tenant,
  tickId,
  consumer,
  recheck,
}) {
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    return { ok: false, reason: 'DURABLE_FIRED_RECEIPT_NOT_FOUND' };
  }
  const receipt = await prisma.continuationReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt || receipt.action !== 'FIRED' || typeof receipt.triggerId !== 'string') {
    return { ok: false, reason: 'DURABLE_FIRED_RECEIPT_NOT_FOUND' };
  }
  if (receipt.tickId !== tickId) return { ok: false, reason: 'TICK_MISMATCH' };

  const [trigger, mission, chain] = await Promise.all([
    prisma.continuationTrigger.findUnique({ where: { id: receipt.triggerId } }),
    prisma.continuationMission.findUnique({ where: { id: receipt.missionId } }),
    verifyReceiptChain(prisma, receipt.missionId),
  ]);
  if (!chain.ok) return { ok: false, reason: 'RECEIPT_CHAIN_INVALID' };
  if (
    !trigger ||
    !mission ||
    trigger.id !== receipt.triggerId ||
    trigger.missionId !== receipt.missionId ||
    trigger.tenant !== tenant ||
    mission.id !== receipt.missionId ||
    mission.tenant !== tenant
  ) {
    return { ok: false, reason: 'TENANT_OR_IDENTITY_MISMATCH' };
  }
  if (trigger.status !== 'FIRED') return { ok: false, reason: 'TRIGGER_NOT_FIRED' };
  if (trigger.authorityCeiling !== 'OBSERVE_ONLY') {
    return { ok: false, reason: 'AUTHORITY_MISMATCH' };
  }

  const requirement = parseJsonObject(trigger.evidenceRequirements);
  if (
    !requirement ||
    requirement.consumer !== consumer ||
    requirement.recheck !== recheck ||
    typeof requirement.opportunityId !== 'string' ||
    requirement.opportunityId.length === 0
  ) {
    return { ok: false, reason: 'EXPECTED_CONSUMER_EVIDENCE_MISSING' };
  }
  const firedEvidence = parseJsonObject(receipt.evidence);
  if (
    !firedEvidence ||
    firedEvidence.tenantId !== tenant ||
    firedEvidence.authorityCeiling !== 'OBSERVE_ONLY' ||
    firedEvidence.evidenceRequirements !== trigger.evidenceRequirements
  ) {
    return { ok: false, reason: 'FIRED_EVIDENCE_BINDING_MISMATCH' };
  }
  return { ok: true, receipt, trigger, mission, requirement };
}

/**
 * Find durable FIRED receipts whose registered consumer has not yet written a
 * REFLECTED receipt. This is the retry queue: a process may die after firing,
 * and a later tick can resume the consumer without re-firing the trigger.
 */
export async function loadPendingFiredConsumerReceipts(prisma, {
  tenant,
  consumer,
  limit = 50,
}) {
  if (typeof tenant !== 'string' || tenant.length === 0) {
    throw new Error('CANA_CONTINUATION_CONSUMER_TENANT_REQUIRED');
  }
  if (consumer !== 'ask_market_gap_recheck') {
    throw new Error('CANA_CONTINUATION_CONSUMER_NOT_REGISTERED');
  }
  const boundedLimit = Math.min(Math.max(1, Number(limit) || 50), 500);
  const routingHint = `%\"consumer\":\"${consumer}\"%`;
  const rows = await prisma.$queryRaw`
    SELECT fired."id", fired."tickId"
    FROM "ContinuationReceipt" AS fired
    INNER JOIN "ContinuationTrigger" AS trigger
      ON trigger."id" = fired."triggerId"
    INNER JOIN "ContinuationMission" AS mission
      ON mission."id" = fired."missionId"
    WHERE fired."action" = 'FIRED'
      AND trigger."tenant" = ${tenant}
      AND mission."tenant" = ${tenant}
      AND trigger."status" = 'FIRED'
      AND trigger."evidenceRequirements" LIKE ${routingHint}
      AND NOT EXISTS (
        SELECT 1
        FROM "ContinuationReceipt" AS reflected
        WHERE reflected."triggerId" = fired."triggerId"
          AND reflected."tickId" = fired."tickId"
          AND reflected."action" = 'REFLECTED'
      )
    ORDER BY fired."recordedAt" ASC, fired."id" ASC
    LIMIT ${boundedLimit}
  `;
  return Object.freeze(rows.map((row) => Object.freeze({ id: row.id, tickId: row.tickId })));
}

async function appendReceiptInTransaction(prisma, body) {
  const mission = await prisma.continuationMission.findUnique({
    where: { id: body.missionId },
    select: { id: true, tenant: true },
  });
  if (!mission) throw new Error('CANA_CONTINUATION_RECEIPT_MISSION_NOT_FOUND');
  if (body.triggerId) {
    const trigger = await prisma.continuationTrigger.findUnique({
      where: { id: body.triggerId },
      select: { missionId: true, tenant: true },
    });
    if (!trigger || trigger.missionId !== body.missionId || trigger.tenant !== mission.tenant) {
      throw new Error('CANA_CONTINUATION_RECEIPT_TRIGGER_MISSION_MISMATCH');
    }
  }
  const head = await prisma.continuationReceipt.findFirst({
    where: { missionId: body.missionId },
    orderBy: { seq: 'desc' },
    select: { seq: true, entryHash: true },
  });
  const seq = (head?.seq ?? 0) + 1;
  const prevHash = head?.entryHash ?? GENESIS_HASH;
  const entryHash = await receiptHash({ ...body, seq }, prevHash);
  const receipt = await prisma.continuationReceipt.create({
    data: {
      seq,
      missionId: body.missionId,
      triggerId: body.triggerId ?? null,
      tickId: body.tickId,
      action: body.action,
      detail: body.detail ?? null,
      evidence: body.evidence ?? null,
      prevHash,
      entryHash,
    },
  });
  await prisma.continuationMission.update({
    where: { id: body.missionId },
    data: { latestReceiptId: receipt.id },
  });
  if (body.triggerId) {
    await prisma.continuationTrigger.update({
      where: { id: body.triggerId },
      data: { latestReceiptId: receipt.id },
    });
  }
  return receipt;
}

export async function appendReceipt(
  prisma,
  body,
  { retryOnConflict = true } = {},
) {
  if (typeof prisma?.$transaction !== 'function') {
    return appendReceiptInTransaction(prisma, body);
  }
  if (!retryOnConflict) return appendReceiptInTransaction(prisma, body);
  return inSerializableTransaction(prisma, (tx) =>
    appendReceiptInTransaction(tx, body));
}

export async function verifyReceiptChain(prisma, missionId) {
  const mission = await prisma.continuationMission.findUnique({
    where: { id: missionId },
    select: { latestReceiptId: true },
  });
  if (!mission) return { ok: false, reason: 'mission does not exist' };
  const rows = await prisma.continuationReceipt.findMany({
    where: { missionId },
    orderBy: { seq: 'asc' },
  });
  let prevHash = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== prevHash) {
      return {
        ok: false,
        brokenAtSeq: row.seq,
        reason: 'prevHash does not match chain head',
      };
    }
    const expected = await receiptHash(row, prevHash);
    if (row.entryHash !== expected) {
      return {
        ok: false,
        brokenAtSeq: row.seq,
        reason: 'entryHash does not match recomputed hash',
      };
    }
    prevHash = row.entryHash;
  }
  const observedHeadId = rows.at(-1)?.id ?? null;
  if (observedHeadId !== mission.latestReceiptId) {
    return {
      ok: false,
      brokenAtSeq: rows.at(-1)?.seq ?? 0,
      reason: 'receipt chain head does not match mission latestReceiptId',
    };
  }
  return { ok: true, length: rows.length };
}
