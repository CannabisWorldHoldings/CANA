// MD MARKET REGISTRY — Maryland Transfer Test #2. Cited data only; anything
// pending or unpublished is an explicit UNKNOWN, never a guess.

export const MD_MARKET = Object.freeze({
  marketId: 'US-MD',
  regulator: {
    name: 'Maryland Cannabis Administration',
    shortName: 'MCA',
    url: 'https://cannabis.maryland.gov',
  },
  legalityModel: {
    medical: 'OPERATIONAL',
    adultUseRetail: 'OPERATIONAL', // since 2023-07-01
    citations: [
      'https://cannabis.maryland.gov',
      'https://dsd.maryland.gov/regulations/Pages/14.17.01.00.aspx',
    ],
  },
  deliveryModel: {
    // COMAR 14.17: dispensary-operated delivery only; Maryland issues NO
    // stand-alone third-party delivery-operator license class (contrast:
    // VA Code § 4.1-805). Modeled per the delivery honesty law.
    retailerOperatedDelivery: 'PERMITTED',
    independentDeliveryOperatorClass: 'NONE',
    citations: ['https://dsd.maryland.gov/regulations/Pages/14.17.12.00.aspx'],
  },
  admittedSources: Object.freeze([
    {
      sourceId: 'md-mca-dispensaries',
      url: 'https://cannabis.maryland.gov/Pages/Dispensaries.aspx',
      authority: 'REGULATOR',
      contentClass: 'FACILITY_REGISTRY',
    },
  ]),
  watchTargets: Object.freeze([
    { id: 'md-mca-dispensaries-diff', url: 'https://cannabis.maryland.gov/Pages/Dispensaries.aspx', signal: 'REGISTRY_CHANGE' },
    { id: 'md-mca-home', url: 'https://cannabis.maryland.gov/Pages/home.aspx', signal: 'REGULATOR_ANNOUNCEMENT' },
  ]),
  unknowns: Object.freeze([
    'LICENSE_NUMBERS_NOT_PUBLISHED_ON_REGISTRY_PAGE',
    'SOCIAL_EQUITY_ROUND_TWO_DISPENSARY_OPENINGS_ROLLING',
  ]),
});

export function validateMdMarket(market = MD_MARKET) {
  if (market.marketId !== 'US-MD') throw new Error('invalid marketId');
  for (const s of market.admittedSources) {
    if (s.authority !== 'REGULATOR') throw new Error(`non-regulator source: ${s.sourceId}`);
    if (!s.url.startsWith('https://cannabis.maryland.gov/')) throw new Error(`foreign source url: ${s.url}`);
  }
  if (market.deliveryModel.independentDeliveryOperatorClass !== 'NONE') {
    throw new Error('MD has no third-party delivery class — do not invent one');
  }
  return true;
}
