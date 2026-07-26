import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * COLUMN WIDTH CUTOVER COURT.
 *
 * THE DEFECT THIS BLOCKS. On SQLite, `String` is TEXT and holds anything. On
 * MySQL/MariaDB — the documented production candidate — Prisma maps an unannotated
 * `String` to **VARCHAR(191)**. The schema is therefore silently correct today and
 * silently wrong the moment the provider changes, which is the most dangerous shape a
 * defect can have: it cannot be reproduced in any test that runs against the current
 * database.
 *
 * WHY IT IS SEVERE HERE RATHER THAN MERELY UNTIDY. `DemandCreditEntry.evidenceChain`
 * carries the JSON proof behind an attributed merchant action, and it is HASHED into
 * the append-only ledger. Measured below, not estimated: a real five-link chain is
 * over 400 characters. Truncated at 191 the digest no longer matches, and the
 * remaining text is not even parseable JSON.
 *
 * So under MySQL in non-strict mode every attributed action would fail its own
 * evidence check and a merchant's proven value would silently fall to zero — no
 * error, no exception, a quietly wrong number on an invoice. In strict mode the
 * insert errors instead (P2000), which is better but still a broken handoff.
 *
 * WHY THE FIX IS NOT APPLIED IN THIS COMMIT. `@db.Text` is a MySQL-family native
 * type. Prisma REFUSES it while the provider is sqlite — measured: `prisma validate`
 * fails. The annotation therefore cannot be pre-staged; it must land in the same
 * change that flips the provider. That is precisely why this court exists: the defect
 * cannot be fixed early, so it must be made impossible to FORGET.
 *
 * These tests pass today and are designed to FAIL LOUDLY the moment someone changes
 * the provider without widening the columns.
 */

const SCHEMA = 'prisma/schema.prisma';

/** Columns the codebase writes long-form values into. */
const LONG_FORM_COLUMNS = [
  ['DemandCreditEntry', 'evidenceChain'],
  ['Article', 'content'],
  ['AuditLog', 'details'],
  ['StagingABCARetailer', 'rawJson'],
  ['SiteObservation', 'summary'],
  ['SiteObservation', 'evidence'],
  ['SiteObservation', 'uncertainty'],
  ['SiteObservation', 'preparedAction'],
  ['Dispute', 'oldValue'],
  ['Dispute', 'newValue'],
  ['LicenseEvidence', 'notes'],
  ['Brand', 'description'],
  ['Product', 'description'],
  ['Deal', 'description'],
  ['LoyaltyTransaction', 'description'],
];

const MYSQL_DEFAULT_VARCHAR = 191;

function schema() {
  return fs.readFileSync(SCHEMA, 'utf8');
}

function providerOf(src) {
  return src.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/s)?.[1] ?? null;
}

function fieldLine(src, model, field) {
  const block = src.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!block) return null;
  return block.split('\n').find((l) => new RegExp(`^\\s{2}${field}\\s`).test(l)) ?? null;
}

// ------------------------------------------------------- the measured evidence
test('MEASURED: a real evidence chain is far longer than VARCHAR(191)', () => {
  // Built exactly as the handoff route builds it, so this is not an estimate.
  const chain = [
    { step: 'tenant_resolved', ref: 'orderweeddc.localhost#c1a2b3d4-e5f6-7890-abcd-ef1234567890' },
    { step: 'same_origin_form_post', ref: '/retailer/c1a2b3d4-e5f6-7890-abcd-ef1234567890/handoff' },
    { step: 'destination_verified', ref: 'https://www.example-dispensary-washington-dc.com/menu/order-online' },
    { step: 'page_challenge', ref: 'VERIFIED' },
    { step: 'interaction_graded', ref: 'MERCHANT_HANDOFF_VERIFIED' },
  ];
  const json = JSON.stringify(chain);
  assert.ok(json.length > MYSQL_DEFAULT_VARCHAR,
    `a five-link chain is ${json.length} chars; VARCHAR(191) would truncate it`);

  // The consequence, spelled out rather than asserted abstractly.
  const full = crypto.createHash('sha256').update(json).digest('hex');
  const truncated = crypto.createHash('sha256').update(json.slice(0, MYSQL_DEFAULT_VARCHAR)).digest('hex');
  assert.notEqual(full, truncated,
    'a truncated chain hashes differently, so every attributed action would fail its own evidence check');

  assert.throws(() => JSON.parse(json.slice(0, MYSQL_DEFAULT_VARCHAR)),
    'the truncated value is not even parseable JSON — the evidence is destroyed, not merely shortened');
});

test('MEASURED: five links is not the worst case — chains grow', () => {
  // The ledger accepts longer chains. If five already overflows by 2x, the real
  // ceiling is nowhere near 191.
  const link = (i) => ({ step: `verification_step_${i}`, ref: `https://source.example.com/evidence/${i}` });
  const ten = JSON.stringify(Array.from({ length: 10 }, (_, i) => link(i)));
  assert.ok(ten.length > MYSQL_DEFAULT_VARCHAR * 3,
    `a ten-link chain is ${ten.length} chars — more than triple the MySQL default`);
});

// ------------------------------------------------------------- the live guard
test('THE GATE: if the provider is MySQL-family, long columns MUST be widened', () => {
  // This is the assertion that makes the defect impossible to forget. It is inert
  // while the provider is sqlite and becomes a hard blocker the instant it is not.
  const src = schema();
  const provider = providerOf(src);
  assert.ok(provider, 'the schema must declare a provider');

  if (!['mysql', 'mariadb'].includes(provider)) {
    // Not yet applicable — but the reason must stay visible in the record.
    assert.equal(provider, 'sqlite',
      `unexpected provider "${provider}" — review column widths before proceeding`);
    return;
  }

  const unwidened = [];
  for (const [model, field] of LONG_FORM_COLUMNS) {
    const line = fieldLine(src, model, field);
    if (!line) continue; // the model may have been removed; absence is not a defect
    if (!/@db\.(Text|LongText|MediumText)/.test(line)) unwidened.push(`${model}.${field}`);
  }
  assert.deepEqual(unwidened, [],
    `these columns hold long-form values and would be TRUNCATED at VARCHAR(191) on ${provider}. `
    + 'DemandCreditEntry.evidenceChain in particular is hashed into the ledger: truncation makes '
    + 'every attributed action fail its own evidence check, and a merchant\'s proven value silently '
    + 'drops to zero. Add @db.Text in the SAME change that flips the provider.');
});

test('the at-risk column list stays honest as the schema grows', () => {
  // A guard that lists columns rots the moment someone adds a new long-form field.
  // This re-derives the list from the schema and fails if something new appears.
  const src = schema();
  const LONG_NAME = /^(content|details|rawJson|summary|evidence|uncertainty|preparedAction|description|oldValue|newValue|notes|evidenceChain)$/;
  const known = new Set(LONG_FORM_COLUMNS.map(([m, f]) => `${m}.${f}`));
  const found = [];
  let model = null;
  for (const line of src.split('\n')) {
    const m = line.match(/^model\s+(\w+)/);
    if (m) { model = m[1]; continue; }
    if (!model) continue;
    const f = line.match(/^\s{2}(\w+)\s+String\??/);
    if (f && LONG_NAME.test(f[1])) found.push(`${model}.${f[1]}`);
  }
  const unlisted = found.filter((x) => !known.has(x));
  assert.deepEqual(unlisted, [],
    'these long-form String columns are not in LONG_FORM_COLUMNS, so the cutover gate '
    + 'would not protect them. Add them to the list.');
});

test('DOCUMENTED: @db.Text cannot be pre-staged while the provider is sqlite', () => {
  // Recording WHY the obvious fix is not already applied. Prisma rejects a
  // MySQL-family native type on a sqlite datasource — measured, `prisma validate`
  // fails. Without this note the next reader reasonably assumes the omission is an
  // oversight and "fixes" it into a schema that will not validate.
  const src = schema();
  if (providerOf(src) !== 'sqlite') return;
  // COMMENTS MUST BE STRIPPED FIRST. My first version grepped raw source and failed,
  // because the schema header already CARRIES a note about needing @db.Text at
  // cutover — written independently by the migration lane, which reached the same
  // conclusion from the other direction. A guard that punishes the documentation of
  // the very defect it guards is the same mistake I made once before in
  // release-identity, and it teaches people to delete the documentation.
  const code = src.replace(/\/\/.*$/gm, '');
  const annotated = code.match(/^\s{2}\w+\s+\w+\??\s+.*@db\.(Text|LongText|MediumText)/gm) ?? [];
  assert.deepEqual(annotated, [],
    'a MySQL native type on a sqlite datasource fails `prisma validate` — the widening '
    + 'must land in the same change as the provider flip, not before it');
});
