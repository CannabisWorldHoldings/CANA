// MD MARKET CLAIMS — Maryland's claim formation, expressed as parameters
// over the market-parametric claim core (extracted at fork ×2). Laws
// unchanged: UNKNOWN default; md-mca-identity-v1 name+address identity;
// license = explicit UNKNOWN (the MCA registry page publishes no license
// numbers); nameless locations form no claims — never invented.
//
// NOTE: the execution-provenance court reads this file's version literals
// at the pinned commit — they stay defined here.

import { createMarketClaimFormer } from '../market-claims.mjs';

export const MD_CLAIMS_SCHEMA_VERSION = 'cana-md-market-claims/v1';
export const MD_ENTITY_NORMALIZATION_VERSION = 'md-mca-identity-v1';

const former = createMarketClaimFormer({
  marketId: 'US-MD',
  schemaVersion: MD_CLAIMS_SCHEMA_VERSION,
  normalizationVersion: MD_ENTITY_NORMALIZATION_VERSION,
  identityPrefix: 'md-mca',
  licenseAbsenceReason: 'MCA_REGISTRY_PAGE_PUBLISHES_NO_LICENSE_NUMBER',
  formerName: 'formMdMarketClaims',
  predicatesFor(statement) {
    const predicates = [
      ['mca_registry_listing_exists', 'DISPENSARY'],
      ['facility_name', statement.name],
      ['regulated_address', `${statement.address.street}, ${statement.address.city}, MD ${statement.address.zip}`],
    ];
    if (statement.phone) predicates.push(['phone', statement.phone]);
    if (statement.website) predicates.push(['website', statement.website]);
    return predicates;
  },
});

export const normalizeMdEntityIdentity = former.normalizeIdentity;
export const formMdMarketClaims = former.formClaims;
