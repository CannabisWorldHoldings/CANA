// Usage: node _verify_mutate.mjs <command> [args...]
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const [cmd, ...args] = process.argv.slice(2);

async function main() {
  if (cmd === 'setSponsored') {
    const [merchantId, val] = args;
    const r = await prisma.retailer.update({ where: { id: merchantId }, data: { isSponsored: val === '1' } });
    console.log('set isSponsored=', r.isSponsored, 'for', r.name);
  } else if (cmd === 'countRows') {
    const [merchantId] = args;
    const c = await prisma.demandCreditEntry.count({ where: { merchantId } });
    console.log('rows for', merchantId, '=', c);
  } else if (cmd === 'dump') {
    const rows = await prisma.demandCreditEntry.findMany({ orderBy: [{merchantId:'asc'},{seq:'asc'}] });
    for (const e of rows) console.log(JSON.stringify({seq:e.seq, merchantId:e.merchantId, kind:e.kind, amount:e.amount, placement:e.placement, disclosureLabel:e.disclosureLabel, affectsOrganicOrder:e.affectsOrganicOrder, originalSeq:e.originalSeq, expiresAt:e.expiresAt, entryHash:e.entryHash?.slice(0,10), prevHash:e.prevHash?.slice(0,10)}));
  } else if (cmd === 'sponsoredFlags') {
    const rs = await prisma.retailer.findMany({ where: { isSponsored: true }, select: { id:true, name:true, isSponsored:true } });
    console.log('retailers with isSponsored=true:', JSON.stringify(rs, null, 0));
  } else if (cmd === 'addEntry') {
    // addEntry '<json>'
    const obj = JSON.parse(args[0]);
    if (obj.expiresAt) obj.expiresAt = new Date(obj.expiresAt);
    if (obj.recordedAt) obj.recordedAt = new Date(obj.recordedAt);
    const r = await prisma.demandCreditEntry.create({ data: obj });
    console.log('created entry seq=', r.seq, 'merchant=', r.merchantId, 'kind=', r.kind, 'id=', r.id);
  } else if (cmd === 'delEntry') {
    // delEntry <merchantId> <seq>
    const [merchantId, seq] = args;
    const r = await prisma.demandCreditEntry.deleteMany({ where: { merchantId, seq: Number(seq) } });
    console.log('deleted', r.count, 'entries at seq', seq, 'for', merchantId);
  } else if (cmd === 'delAllForMerchant') {
    const [merchantId] = args;
    const r = await prisma.demandCreditEntry.deleteMany({ where: { merchantId } });
    console.log('deleted', r.count, 'entries for', merchantId);
  } else if (cmd === 'updEntry') {
    // updEntry <merchantId> <seq> '<json patch>'
    const [merchantId, seq, patchStr] = args;
    const patch = JSON.parse(patchStr);
    if (patch.expiresAt) patch.expiresAt = new Date(patch.expiresAt);
    const r = await prisma.demandCreditEntry.updateMany({ where: { merchantId, seq: Number(seq) }, data: patch });
    console.log('updated', r.count, 'rows');
  } else {
    console.log('unknown cmd', cmd);
  }
  await prisma.$disconnect();
}
main().catch(async e => { console.error('ERR', e.message); await prisma.$disconnect(); process.exit(1); });
