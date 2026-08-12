import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseCcaRegistryPage,
  parseCcaProcessorAccordion,
  VA_CCA_PARSER_RULE_VERSION,
} from '../src/lib/markets/va/va-cca-registry-parser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  readFileSync(path.join(here, 'fixtures', 'va-cca', name), 'utf8');

const DISPENSARIES = fixture('dispensaries.html');
const PROCESSORS = fixture('processors.html');
const SOURCE = {
  url: 'https://www.cca.virginia.gov/medicalcannabis/dispensaries',
  pageSha256: '589f64ab5407e442', // abbreviated; full hash in fixture header
};

test('parser law: extraction requires nonempty html', () => {
  assert.throws(() => parseCcaRegistryPage(''), /nonempty/);
  assert.throws(() => parseCcaRegistryPage(undefined), /nonempty/);
});

test('dispensaries fixture: extracts a real registry, VA-only, deduplicated', () => {
  const { records, rejects } = parseCcaRegistryPage(DISPENSARIES, SOURCE);
  // The CCA registry listed 23 physical dispensaries at fixture capture time.
  // The parser must find a substantial registry — a hard lower bound guards
  // against silent extraction collapse; the exact count is asserted by the
  // pinned-count test below so a CCA page change fails LOUDLY, not silently.
  assert.ok(records.length >= 20, `expected >=20 records, got ${records.length}`);

  for (const r of records) {
    assert.equal(r.statementType, 'CCA_REGISTRY_LISTING');
    assert.ok(r.name.length > 2, 'name present');
    assert.equal(r.address.state, 'VA');
    assert.match(r.address.zip, /^\d{5}$/);
    assert.ok(r.address.street.length > 4, `street present for ${r.name}`);
    assert.ok(r.address.city.length > 2, `city present for ${r.name}`);
    assert.equal(r.provenance.parserRule, VA_CCA_PARSER_RULE_VERSION);
    assert.equal(r.provenance.sourceUrl, SOURCE.url);
  }

  // No duplicate identities (dedupe law).
  const keys = records.map((r) => `${r.name}|${r.address.street}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate records');

  // Known ground-truth entries from the capture (operators per CCA HSAs).
  const names = records.map((r) => r.name.toLowerCase()).join('\n');
  assert.match(names, /beyond hello/i);
  // Rejects are inspectable, not silently dropped.
  assert.ok(Array.isArray(rejects));
});

test('dispensaries fixture: pinned extraction count (loud-change law)', () => {
  const { records } = parseCcaRegistryPage(DISPENSARIES, SOURCE);
  // PINNED at fixture capture (2026-08-12). If CCA adds/removes a facility,
  // refresh the fixture AND this pin in the same commit — that is the point.
  assert.equal(records.length, PINNED_DISPENSARY_COUNT);
});

test('processors fixture: extracts all five HSA processors from the accordion', () => {
  const { records, rejects } = parseCcaProcessorAccordion(PROCESSORS, {
    url: 'https://www.cca.virginia.gov/medicalcannabis/processors',
  });
  assert.equal(records.length, PINNED_PROCESSOR_COUNT);
  const hsas = records.map((r) => r.healthServiceArea).sort();
  assert.deepEqual(hsas, [1, 2, 3, 4, 5], 'exactly one processor per HSA');
  for (const r of records) {
    assert.equal(r.statementType, 'CCA_PROCESSOR_LISTING');
    assert.ok(r.operator.name.length > 2);
    assert.match(r.operator.website, /^https?:\/\//);
    assert.equal(r.provenance.parserRule, VA_CCA_PARSER_RULE_VERSION);
  }
  // HSA1 carries the CCA's stated conditional-approval status — extracted, not guessed.
  const hsa1 = records.find((r) => r.healthServiceArea === 1);
  assert.equal(hsa1.statusText, 'CONDITIONAL_APPROVAL');
  // FAQ accordion items are rejected with reasons, not silently dropped.
  assert.ok(rejects.every((x) => x.reason));
});

test('parser never invents fields (unknowns stay absent)', () => {
  const html =
    '<div class="sqs-html-content"><p class="sqsrte-large">Test Facility</p>' +
    '<p class="">1 Main St<br>Richmond, VA 23220</p></div>';
  const { records } = parseCcaRegistryPage(html, {});
  assert.equal(records.length, 1);
  assert.equal(records[0].phone, undefined);
  assert.equal(records[0].website, undefined);
  assert.equal(records[0].provenance.pageSha256, null);
});

test('non-VA and malformed addresses are rejected with reasons', () => {
  const html =
    '<div class="sqs-html-content"><p class="sqsrte-large">Maryland Shop</p>' +
    '<p class="">1 Main St<br>Bethesda, MD 20814</p></div>';
  const { records, rejects } = parseCcaRegistryPage(html, {});
  assert.equal(records.length, 0);
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].reason, 'NO_VA_ADDRESS_LAW_MATCH');
});

// Pins — refreshed together with fixtures, never edited alone.
const PINNED_DISPENSARY_COUNT = Number(
  process.env.VA_FIXTURE_DISPENSARY_PIN ?? '23',
);
const PINNED_PROCESSOR_COUNT = Number(
  process.env.VA_FIXTURE_PROCESSOR_PIN ?? '5',
);
