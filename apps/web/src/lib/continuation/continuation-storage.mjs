import { GENESIS_HASH, receiptHash } from './continuation-core.mjs';

export async function inSerializableTransaction(prisma, operation, attempt = 0) {
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

export async function appendReceipt(
  prisma,
  body,
  { attempt = 0, retryOnConflict = true } = {},
) {
  const head = await prisma.continuationReceipt.findFirst({
    where: { missionId: body.missionId },
    orderBy: { seq: 'desc' },
    select: { seq: true, entryHash: true },
  });
  const seq = (head?.seq ?? 0) + 1;
  const prevHash = head?.entryHash ?? GENESIS_HASH;
  const entryHash = await receiptHash({ ...body, seq }, prevHash);
  try {
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
  } catch (error) {
    if (retryOnConflict && attempt < 3 && String(error?.code) === 'P2002') {
      return appendReceipt(prisma, body, {
        attempt: attempt + 1,
        retryOnConflict,
      });
    }
    throw error;
  }
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
