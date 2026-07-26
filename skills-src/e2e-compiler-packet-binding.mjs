// END-TO-END: real Context Compiler output driving the real governed packet.
// Fixtures can agree with each other while the real objects disagree, so the
// binding is only proven when the compiler's ACTUAL output shape is consumed.
import { compile, labelFact } from './sitemind-context-compiler.mjs';
import { sealPacket } from './hermes-governed-packet.mjs';

const now = new Date('2026-07-26T12:00:00Z');
const f = (o) => ({ authority: 'LIVE_RUNTIME_OR_BROWSER_EVIDENCE', truth_status: 'VERIFIED',
  source: 'test', valid_for_days: 30, observed_at: now.toISOString(), tags: [], ...o });

const grant = { valid: true, grant_id: 'g1', capability: 'WRITE_LOCAL_FILE',
  budget_units: 10, expires_at: new Date(now.getTime() + 3600_000).toISOString(), issued_by: 'CANA' };
const intent = { description: 'update the retailer cache', capability: 'WRITE_LOCAL_FILE',
  successTest: 'cache file contains 5 rows', rollback: 'restore prior cache',
  subjects: ['subject:Retailer_Cache'] };  // deliberately odd case/underscore

// CASE 1 — clean context: the action should proceed.
const clean = compile({ objective: 'refresh cache', now, facts: [
  f({ id: 'c1', claim: 'retailer cache is stale', tags: ['subject:retailer_cache'] }),
] });
const r1 = sealPacket({ contextPacket: clean.packet, grant, intent, now });
console.log('  CASE 1 clean context      -> valid:', r1.valid);

// CASE 2 — the compiler DETECTS a contradiction on the action's own subject,
// with case/whitespace variation on both sides. The action must be refused.
const conflicted = compile({ objective: 'refresh cache', now, facts: [
  f({ id: 'x1', claim: 'cache holds 5 rows', tags: ['subject:Retailer_Cache'] }),
  f({ id: 'x2', claim: 'cache holds 0 rows', tags: ['subject:retailer_cache '] }),
] });
console.log('  compiler found contradictions:', conflicted.packet.contradictions.length,
            '| subject:', JSON.stringify(conflicted.packet.contradictions[0]?.subject));
const r2 = sealPacket({ contextPacket: conflicted.packet, grant, intent, now });
console.log('  CASE 2 contradicted subject -> valid:', r2.valid);
console.log('    reason:', (r2.errors[0] ?? '').slice(0, 95));

// CASE 3 — a STALE strongest authority must not be preferred on authority alone.
const old = new Date(now.getTime() - 400 * 86400_000).toISOString();
const stale = compile({ objective: 'refresh cache', now, facts: [
  f({ id: 's1', claim: 'ship the cache', authority: 'OWNER_EXPLICIT_DIRECTIVE',
      observed_at: old, valid_for_days: 7, tags: ['subject:retailer_cache'] }),
  f({ id: 's2', claim: 'do not ship the cache', tags: ['subject:retailer_cache'] }),
] });
const c3 = stale.packet.contradictions[0];
console.log('  compiler: strongest =', c3?.strongest_id, '| actionable:', c3?.strongest_is_actionable);
const r3 = sealPacket({ contextPacket: stale.packet, grant, intent, now });
console.log('  CASE 3 stale strongest      -> valid:', r3.valid);

const ok = r1.valid === true && r2.valid === false && r3.valid === false;
console.log('\n  END-TO-END BINDING:', ok ? 'PROVEN' : 'FAILED');
process.exit(ok ? 0 : 1);
