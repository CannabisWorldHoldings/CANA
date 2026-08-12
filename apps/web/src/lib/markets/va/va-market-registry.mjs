// VA MARKET REGISTRY — Virginia Pre-Entry slice 1 (Transfer Test #1).
//
// The market descriptor for US-VA as DATA with citations. Every date and
// structural fact below is bound to its statutory or official source. This
// file asserts nothing about the world that its citations do not; anything
// pending rulemaking is represented as an explicit UNKNOWN, never a guess.
//
// Lineage: this is the first instance of the market-adapter genome described
// in docs/markets/VIRGINIA_PRE_ENTRY.md — the compiler input for market n=2.

export const VA_MARKET = Object.freeze({
  marketId: 'US-VA',
  regulator: {
    name: 'Virginia Cannabis Control Authority',
    shortName: 'CCA',
    url: 'https://www.cca.virginia.gov',
  },
  legalityModel: {
    medical: 'OPERATIONAL',
    adultUsePossession: 'LEGAL', // 2 oz, VA Code § 4.1-1100
    adultUseRetail: 'COUNTDOWN', // earliest 2027-07-01
    citations: [
      'https://law.lis.virginia.gov/vacode/title4.1/chapter11/section4.1-1100/',
      'https://www.cca.virginia.gov/retailmarijuanamarket',
    ],
  },
  countdown: Object.freeze([
    {
      date: '2027-02-01',
      event: 'RETAIL_LICENSE_APPLICATIONS_OPEN',
      citation: 'https://www.cca.virginia.gov/retailmarijuanamarket',
    },
    {
      date: '2027-05-01',
      event: 'INITIAL_LICENSES_ISSUED',
      citation: 'https://www.cca.virginia.gov/retailmarijuanamarket',
    },
    {
      date: '2027-06-01',
      event: 'MEDICAL_PERMITS_INVALID_WITHOUT_DUAL_USE_CONVERSION',
      citation: 'https://law.lis.virginia.gov/vacode/title4.1/chapter16/section4.1-1602/',
    },
    {
      date: '2027-07-01',
      event: 'EARLIEST_LEGAL_RETAIL_SALE',
      citation: 'https://www.cca.virginia.gov/retailmarijuanamarket',
    },
  ]),
  licenseClasses: Object.freeze([
    { id: 'CULTIVATION', tiers: 5 },
    { id: 'PROCESSING' },
    { id: 'TESTING_LABORATORY' },
    { id: 'TRANSPORTER', scope: 'B2B_ONLY' },
    {
      id: 'DELIVERY_OPERATOR',
      scope: 'THIRD_PARTY_DELIVERY',
      citation: 'https://law.lis.virginia.gov/vacode/title4.1/chapter8/section4.1-805/',
      notes: 'Takes possession from retail stores/microbusinesses only; in-person delivery only.',
    },
    {
      id: 'RETAIL_MARIJUANA_STORE',
      statewideCap: 350,
      citation: 'https://law.lis.virginia.gov/vacode/title4.1/chapter6/section4.1-606/',
    },
    { id: 'MICROBUSINESS' },
    { id: 'DUAL_USE_PERMIT', conversionFeeUsd: 10_000_000 },
  ]),
  localityPowers: {
    optOut: 'NONE', // deliberate: no referendum/opt-out in the enacted framework
    citations: [
      'https://law.lis.virginia.gov/vacode/title4.1/chapter6/section4.1-629/',
      'https://law.lis.virginia.gov/vacode/title4.1/chapter6/section4.1-630/',
    ],
  },
  // Admitted official sources for this market. Only entries here may feed
  // the reality lane (mirrors the admitted-source-registry law from the
  // D.C. live acquisition work).
  admittedSources: Object.freeze([
    {
      sourceId: 'va-cca-dispensaries',
      url: 'https://www.cca.virginia.gov/medicalcannabis/dispensaries',
      authority: 'REGULATOR',
      contentClass: 'FACILITY_REGISTRY',
    },
    {
      sourceId: 'va-cca-processors',
      url: 'https://www.cca.virginia.gov/medicalcannabis/processors',
      authority: 'REGULATOR',
      contentClass: 'FACILITY_REGISTRY',
    },
    {
      sourceId: 'va-cca-retail-market',
      url: 'https://www.cca.virginia.gov/retailmarijuanamarket',
      authority: 'REGULATOR',
      contentClass: 'REGULATORY_TIMELINE',
    },
  ]),
  // Watcher targets for the continuation lane (CONDITION_WATCH, OBSERVE_ONLY).
  watchTargets: Object.freeze([
    { id: 'va-cca-news', url: 'https://www.cca.virginia.gov/news', signal: 'REGULATOR_ANNOUNCEMENT' },
    { id: 'va-cca-board', url: 'https://www.cca.virginia.gov/bod', signal: 'BOARD_MEETING' },
    { id: 'va-cca-noa', url: 'https://www.cca.virginia.gov/noa', signal: 'APPLICATION_WINDOW' },
    {
      id: 'va-townhall-board-162',
      url: 'https://townhall.virginia.gov/L/Meetings.cfm?BoardID=162',
      signal: 'RULEMAKING', // NOIRA detection — the public-comment tripwire
    },
    { id: 'va-cca-dispensaries-diff', url: 'https://www.cca.virginia.gov/medicalcannabis/dispensaries', signal: 'REGISTRY_CHANGE' },
    { id: 'va-cca-processors-diff', url: 'https://www.cca.virginia.gov/medicalcannabis/processors', signal: 'REGISTRY_CHANGE' },
  ]),
  // Explicit unknowns pending CCA rulemaking — rendered as UNKNOWN, never guessed.
  unknowns: Object.freeze([
    'DELIVERY_RADIUS_RULES',
    'THIRD_PARTY_PLATFORM_TREATMENT',
    'IMPACT_LICENSE_SET_ASIDE_PERCENT',
    'VERTICAL_INTEGRATION_CAPS_FINAL',
    'STANDARD_LICENSE_FEES',
  ]),
});

/** Every date in the countdown must be a valid ISO date, strictly ordered. */
export function validateCountdown(market = VA_MARKET) {
  let prev = null;
  for (const step of market.countdown) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(step.date) || Number.isNaN(Date.parse(step.date))) {
      throw new Error(`invalid countdown date: ${step.date}`);
    }
    if (!step.citation) throw new Error(`countdown step missing citation: ${step.event}`);
    if (prev && step.date < prev) throw new Error(`countdown out of order at ${step.event}`);
    prev = step.date;
  }
  return true;
}
