import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VA_MARKET,
  validateCountdown,
} from '../src/lib/markets/va/va-market-registry.mjs';

test('market identity and regulator binding', () => {
  assert.equal(VA_MARKET.marketId, 'US-VA');
  assert.equal(VA_MARKET.regulator.shortName, 'CCA');
  assert.match(VA_MARKET.regulator.url, /^https:\/\/www\.cca\.virginia\.gov$/);
});

test('countdown law: valid ISO dates, ordered, every step cited', () => {
  assert.equal(validateCountdown(), true);
  const events = VA_MARKET.countdown.map((s) => s.event);
  assert.deepEqual(events, [
    'RETAIL_LICENSE_APPLICATIONS_OPEN',
    'INITIAL_LICENSES_ISSUED',
    'MEDICAL_PERMITS_INVALID_WITHOUT_DUAL_USE_CONVERSION',
    'EARLIEST_LEGAL_RETAIL_SALE',
  ]);
  assert.equal(VA_MARKET.countdown[0].date, '2027-02-01');
  assert.equal(VA_MARKET.countdown.at(-1).date, '2027-07-01');
});

test('countdown law rejects uncited or disordered steps', () => {
  assert.throws(() =>
    validateCountdown({ countdown: [{ date: '2027-01-01', event: 'X' }] }),
  );
  assert.throws(() =>
    validateCountdown({
      countdown: [
        { date: '2027-05-01', event: 'A', citation: 'https://x' },
        { date: '2027-02-01', event: 'B', citation: 'https://x' },
      ],
    }),
  );
});

test('delivery operator is a first-class third-party license class', () => {
  const delivery = VA_MARKET.licenseClasses.find((c) => c.id === 'DELIVERY_OPERATOR');
  assert.ok(delivery, 'DELIVERY_OPERATOR class present');
  assert.equal(delivery.scope, 'THIRD_PARTY_DELIVERY');
  assert.match(delivery.citation, /4\.1-805/);
});

test('retail cap is bound to statute', () => {
  const retail = VA_MARKET.licenseClasses.find((c) => c.id === 'RETAIL_MARIJUANA_STORE');
  assert.equal(retail.statewideCap, 350);
  assert.match(retail.citation, /4\.1-606/);
});

test('locality powers: no opt-out, cited to 4.1-629/630', () => {
  assert.equal(VA_MARKET.localityPowers.optOut, 'NONE');
  assert.equal(VA_MARKET.localityPowers.citations.length, 2);
});

test('admitted sources are regulator-authority only and complete', () => {
  assert.equal(VA_MARKET.admittedSources.length, 3);
  for (const s of VA_MARKET.admittedSources) {
    assert.equal(s.authority, 'REGULATOR');
    assert.match(s.url, /^https:\/\/www\.cca\.virginia\.gov\//);
  }
});

test('rulemaking tripwire is a watch target', () => {
  const noira = VA_MARKET.watchTargets.find((w) => w.signal === 'RULEMAKING');
  assert.ok(noira, 'NOIRA watch target present');
  assert.match(noira.url, /townhall\.virginia\.gov/);
});

test('unknowns are explicit, not guessed', () => {
  assert.ok(VA_MARKET.unknowns.includes('DELIVERY_RADIUS_RULES'));
  assert.ok(VA_MARKET.unknowns.includes('THIRD_PARTY_PLATFORM_TREATMENT'));
});

test('registry is deeply frozen at the top level', () => {
  assert.throws(() => {
    VA_MARKET.countdown.push({ date: '2030-01-01', event: 'FAKE' });
  });
});
