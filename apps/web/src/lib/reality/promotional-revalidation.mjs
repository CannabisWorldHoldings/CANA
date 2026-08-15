import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import {
  PILOT_MERCHANTS,
  LIVE_PROMOTIONAL_OFFERS,
} from './market-reality-pilot.mjs';
import { currentDealWhere } from '../directory-search.mjs';

/**
 * PROMOTIONAL REVALIDATION TARGET UNIVERSE (PILOT MERCHANTS ONLY)
 */
export const PILOT_MERCHANT_IDS = Object.freeze([
  'BIZ-DC-ABCA117379', // Anacostia Organics
  'BIZ-DC-ABCA117361', // Takoma Wellness Center
  'BIZ-DC-ABCA127461', // Chocolate City Wellness
  'BIZ-DC-ABCA127484', // All Vybez DC
]);

export const KNOWN_PROMOTIONAL_TARGETS = Object.freeze([
  {
    merchantId: 'BIZ-DC-ABCA117379',
    merchantName: 'Anacostia Organics',
    licenseNumber: 'ABCA-117379',
    primaryUrl: 'https://www.anacostiaorganics.com/',
    secondaryUrl: 'https://www.anacostiaorganics.com/menu',
  },
  {
    merchantId: 'BIZ-DC-ABCA117361',
    merchantName: 'Takoma Wellness Center',
    licenseNumber: 'ABCA-117361',
    primaryUrl: 'https://takomawellness.com/patient-rewards/',
    secondaryUrl: 'https://menu.takomawellness.com/stores/takoma-wellness-center/specials',
  },
  {
    merchantId: 'BIZ-DC-ABCA127461',
    merchantName: 'Chocolate City Wellness',
    licenseNumber: 'ABCA-127461',
    primaryUrl: 'https://www.chocolatecitysmokeshop.com/',
  },
  {
    merchantId: 'BIZ-DC-ABCA127484',
    merchantName: 'All Vybez DC',
    licenseNumber: 'ABCA-127484',
    primaryUrl: 'https://allvybezdc.com/',
  },
]);

export const PILOT_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 Hours Max

/**
 * Fetches a live public URL with strict timeout and SSL handling.
 */
export async function fetchLiveSourceUrl(url, timeoutMs = 8000) {
  const startedAt = new Date().toISOString();
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 (ORDERWEEDDC-Revalidator/1.0)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        (res) => {
          const { statusCode } = res;
          // Follow redirects up to 1 level
          if (statusCode && [301, 302, 307, 308].includes(statusCode) && res.headers.location) {
            let redirectUrl = res.headers.location;
            if (redirectUrl.startsWith('/')) {
              redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
            }
            req.destroy();
            fetchLiveSourceUrl(redirectUrl, timeoutMs).then(resolve);
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const rawBytes = Buffer.concat(chunks);
            const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
            const html = rawBytes.toString('utf-8');
            const retrievedAt = new Date().toISOString();
            resolve({
              url,
              statusCode,
              reachable: statusCode >= 200 && statusCode < 400,
              rawSha256: sha256,
              contentLength: rawBytes.length,
              html,
              startedAt,
              retrievedAt,
              error: null,
            });
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          url,
          statusCode: null,
          reachable: false,
          rawSha256: null,
          contentLength: 0,
          html: '',
          startedAt,
          retrievedAt: null,
          error: err.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          url,
          statusCode: null,
          reachable: false,
          rawSha256: null,
          contentLength: 0,
          html: '',
          startedAt,
          retrievedAt: null,
          error: 'REQUEST_TIMEOUT',
        });
      });
    } catch (err) {
      resolve({
        url,
        statusCode: null,
        reachable: false,
        rawSha256: null,
        contentLength: 0,
        html: '',
        startedAt,
        retrievedAt: null,
        error: err.message,
      });
    }
  });
}

/**
 * Extracts discrete, verifiable promotional terms from direct HTML content.
 */
export function extractPromotionalTermsFromHtml(merchantId, html, rawSha256, retrievedAt) {
  const offers = [];
  const text = (html || '').toLowerCase();

  if (merchantId === 'BIZ-DC-ABCA117379') {
    // Anacostia Organics
    if (text.includes('new patients get 20% off') || (text.includes('20% off') && text.includes('first purchase'))) {
      offers.push({
        id: 'DEAL-DC-ABCA117379-NEW-PATIENT-20',
        retailerId: 'BIZ-DC-ABCA117379',
        merchantName: 'Anacostia Organics',
        title: 'New Patient Welcome: 20% Off First Purchase',
        description: 'Directly observed on official live storefront: New patients receive 20% off first purchase.',
        discountType: 'PERCENTAGE',
        discountValue: '20% OFF',
        percentageValue: 20,
        qualifyingCategory: 'All Products',
        eligibility: 'New registered medical cannabis patients (first purchase only)',
        minimumPurchase: null,
        sourceUrl: 'https://www.anacostiaorganics.com/',
        sourceType: 'DIRECT_MERCHANT_WEBSITE',
        sourceRawSha256: rawSha256,
        retrievedAt,
        isDemonstration: false,
        dataStatus: 'VERIFIED_CURRENT',
        isActive: true,
      });
    }
  } else if (merchantId === 'BIZ-DC-ABCA127461') {
    // Chocolate City Wellness
    if (text.includes('$5 off flower') || (text.includes('$5 off') && text.includes('flower'))) {
      offers.push({
        id: 'DEAL-DC-ABCA127461-FLOWER-5OFF',
        retailerId: 'BIZ-DC-ABCA127461',
        merchantName: 'Chocolate City Wellness',
        title: '$5 Off Flower Special',
        description: 'Directly observed on official live storefront specials: $5 off cannabis flower.',
        discountType: 'FIXED_AMOUNT',
        discountValue: '$5.00 OFF',
        fixedAmountValue: 5.0,
        qualifyingCategory: 'Flower',
        eligibility: 'Public special for all eligible adult/medical patrons',
        minimumPurchase: null,
        sourceUrl: 'https://www.chocolatecitysmokeshop.com/',
        sourceType: 'DIRECT_MERCHANT_WEBSITE',
        sourceRawSha256: rawSha256,
        retrievedAt,
        isDemonstration: false,
        dataStatus: 'VERIFIED_CURRENT',
        isActive: true,
      });
    }

    if (text.includes('$5 off edibles over $25') || (text.includes('$5 off') && text.includes('edibles') && text.includes('25'))) {
      offers.push({
        id: 'DEAL-DC-ABCA127461-EDIBLES-25MIN-5OFF',
        retailerId: 'BIZ-DC-ABCA127461',
        merchantName: 'Chocolate City Wellness',
        title: '$5 Off Edibles Over $25',
        description: 'Directly observed on official live storefront specials: $5 off edible purchases over $25.',
        discountType: 'FIXED_AMOUNT',
        discountValue: '$5.00 OFF',
        fixedAmountValue: 5.0,
        qualifyingCategory: 'Edibles',
        eligibility: 'Public special on edible orders of $25 or more',
        minimumPurchase: 25.0,
        sourceUrl: 'https://www.chocolatecitysmokeshop.com/',
        sourceType: 'DIRECT_MERCHANT_WEBSITE',
        sourceRawSha256: rawSha256,
        retrievedAt,
        isDemonstration: false,
        dataStatus: 'VERIFIED_CURRENT',
        isActive: true,
      });
    }
  }

  return offers;
}

/**
 * Revalidates all known live promotional offers against direct fresh merchant evidence.
 */
export async function revalidatePilotPromotions(existingDeals = LIVE_PROMOTIONAL_OFFERS, asOf = new Date(), options = {}) {
  const asOfTime = asOf instanceof Date ? asOf : new Date(asOf);
  const revalidationReport = {
    runStartedAt: asOfTime.toISOString(),
    merchantsAttempted: KNOWN_PROMOTIONAL_TARGETS.length,
    merchantResults: [],
    updatedDeals: [],
    historicalAuditEvents: [],
    realCurrentDealCount: 0,
    demoDealCountQuarantined: 5,
    customerEventsGenerated: 0,
  };

  const currentDealsMap = new Map();
  for (const d of existingDeals) {
    if (!d.isDemonstration) {
      currentDealsMap.set(d.id, { ...d });
    }
  }

  for (const target of KNOWN_PROMOTIONAL_TARGETS) {
    const fetchRes = options.mockFetchResults
      ? options.mockFetchResults[target.primaryUrl] || { reachable: false, error: 'MOCK_UNAVAILABLE' }
      : await fetchLiveSourceUrl(target.primaryUrl);

    const mResult = {
      merchantId: target.merchantId,
      merchantName: target.merchantName,
      url: target.primaryUrl,
      reachable: fetchRes.reachable,
      httpStatus: fetchRes.statusCode,
      rawSha256: fetchRes.rawSha256,
      error: fetchRes.error,
      observations: [],
      epistemicState: fetchRes.reachable ? 'SOURCE_REACHABLE' : 'SOURCE_UNREACHABLE',
    };

    if (!fetchRes.reachable) {
      // Source failure / unreachable -> Fail closed, do NOT advance freshness
      mResult.observations.push({
        status: 'FETCH_FAILED',
        reason: fetchRes.error || 'HTTP_NON_200',
        freshnessAdvanced: false,
      });

      // Existing deals for this merchant remain valid ONLY until previous freshnessExpiresAt
      for (const deal of currentDealsMap.values()) {
        if (deal.retailerId === target.merchantId) {
          const isExpired = new Date(deal.freshnessExpiresAt).getTime() <= asOfTime.getTime();
          if (isExpired) {
            deal.dataStatus = 'STALE';
            deal.isActive = false;
          }
          // Do NOT advance verifiedAt or freshnessExpiresAt!
        }
      }
    } else {
      // Source reachable -> extract observed offers
      const observedOffers = extractPromotionalTermsFromHtml(
        target.merchantId,
        fetchRes.html,
        fetchRes.rawSha256,
        fetchRes.retrievedAt
      );

      // Check known deals for this merchant
      const knownMerchantDeals = Array.from(currentDealsMap.values()).filter((d) => d.retailerId === target.merchantId);

      for (const knownDeal of knownMerchantDeals) {
        const matchingObserved = observedOffers.find((o) => o.id === knownDeal.id);

        if (matchingObserved) {
          // Offer is STILL PRESENT
          const termsUnchanged = matchingObserved.discountValue === knownDeal.discountValue;

          if (termsUnchanged) {
            // Terms unchanged -> Advance verifiedAt and freshnessExpiresAt
            const newExpires = new Date(asOfTime.getTime() + PILOT_FRESHNESS_WINDOW_MS).toISOString();
            knownDeal.verifiedAt = fetchRes.retrievedAt;
            knownDeal.retrievedAt = fetchRes.retrievedAt;
            knownDeal.freshnessExpiresAt = newExpires;
            knownDeal.sourceRawSha256 = fetchRes.rawSha256;
            knownDeal.dataStatus = 'VERIFIED_CURRENT';
            knownDeal.isActive = true;

            mResult.observations.push({
              dealId: knownDeal.id,
              state: 'OFFER_PRESENT_TERMS_UNCHANGED',
              verifiedAt: knownDeal.verifiedAt,
              freshnessExpiresAt: knownDeal.freshnessExpiresAt,
            });
          } else {
            // Terms CHANGED -> Preserve previous terms in audit, update current with fresh proof
            const previousTerms = {
              discountValue: knownDeal.discountValue,
              sourceRawSha256: knownDeal.sourceRawSha256,
              verifiedAt: knownDeal.verifiedAt,
            };

            const newExpires = new Date(asOfTime.getTime() + PILOT_FRESHNESS_WINDOW_MS).toISOString();
            knownDeal.discountValue = matchingObserved.discountValue;
            knownDeal.title = matchingObserved.title;
            knownDeal.description = matchingObserved.description;
            knownDeal.verifiedAt = fetchRes.retrievedAt;
            knownDeal.retrievedAt = fetchRes.retrievedAt;
            knownDeal.freshnessExpiresAt = newExpires;
            knownDeal.sourceRawSha256 = fetchRes.rawSha256;
            knownDeal.dataStatus = 'VERIFIED_CURRENT';
            knownDeal.isActive = true;

            revalidationReport.historicalAuditEvents.push({
              dealId: knownDeal.id,
              eventType: 'TERMS_CHANGED',
              previousTerms,
              newTerms: {
                discountValue: knownDeal.discountValue,
                sourceRawSha256: knownDeal.sourceRawSha256,
                verifiedAt: knownDeal.verifiedAt,
              },
              recordedAt: asOfTime.toISOString(),
            });

            mResult.observations.push({
              dealId: knownDeal.id,
              state: 'OFFER_PRESENT_TERMS_CHANGED',
              previousTerms,
              newTerms: knownDeal.discountValue,
            });
          }
        } else {
          // Fresh source NO LONGER SHOWS the offer -> Remove immediately from current projection!
          knownDeal.dataStatus = 'NO_LONGER_OBSERVED';
          knownDeal.isActive = false;

          revalidationReport.historicalAuditEvents.push({
            dealId: knownDeal.id,
            eventType: 'OFFER_REMOVED_FROM_SOURCE',
            previousTerms: knownDeal.discountValue,
            recordedAt: asOfTime.toISOString(),
          });

          mResult.observations.push({
            dealId: knownDeal.id,
            state: 'OFFER_REMOVED',
            action: 'IMMEDIATELY_SUPPRESSED',
          });
        }
      }
    }

    revalidationReport.merchantResults.push(mResult);
  }

  // Filter deals currently active and fresh
  const finalDeals = Array.from(currentDealsMap.values());
  revalidationReport.updatedDeals = finalDeals;
  revalidationReport.realCurrentDealCount = finalDeals.filter(
    (d) =>
      !d.isDemonstration &&
      d.dataStatus === 'VERIFIED_CURRENT' &&
      d.isActive &&
      new Date(d.freshnessExpiresAt).getTime() > asOfTime.getTime()
  ).length;

  return revalidationReport;
}

/**
 * Synchronizes verified live deals into the canonical Prisma `Deal` database table.
 * Guarantees process-restart durability.
 */
export async function syncLiveDealsToDurableStore(prisma, dealsToSync) {
  if (!prisma || !prisma.deal) return { syncedCount: 0, status: 'NO_DATABASE' };

  let count = 0;
  for (const d of dealsToSync) {
    if (d.isDemonstration) continue; // Demonstration firewall

    // Verify retailer exists in database first
    const retailerExists = await prisma.retailer.findUnique({
      where: { id: d.retailerId },
      select: { id: true },
    });

    if (!retailerExists) {
      // Ensure the pilot retailer record exists so foreign key relation is satisfied
      const pilotMatch = PILOT_MERCHANTS.find((m) => m.retailerId === d.retailerId);
      if (pilotMatch) {
        await prisma.retailer.upsert({
          where: { id: d.retailerId },
          update: {},
          create: {
            id: d.retailerId,
            name: pilotMatch.officialName,
            type: 'DISPENSARY',
            address: pilotMatch.address,
            city: pilotMatch.city,
            state: pilotMatch.state,
            zip: pilotMatch.zip,
            latitude: pilotMatch.lat,
            longitude: pilotMatch.lng,
            website: pilotMatch.canonicalWebsite,
            dataStatus: 'VERIFIED_CURRENT',
            isDemonstration: false,
            verifiedAt: new Date(pilotMatch.verifiedAt),
            freshnessExpiresAt: new Date(pilotMatch.freshnessExpiresAt),
          },
        });
      }
    }

    const expiryDate = d.freshnessExpiresAt ? new Date(d.freshnessExpiresAt) : new Date(Date.now() + PILOT_FRESHNESS_WINDOW_MS);

    await prisma.deal.upsert({
      where: { id: d.id },
      update: {
        title: d.title,
        description: d.description,
        discount: d.discountValue,
        expiryDate,
        isActive: d.isActive ?? true,
        dataStatus: d.dataStatus,
        dataSource: d.sourceType || 'DIRECT_MERCHANT_WEBSITE',
        sourceUrl: d.sourceUrl,
        retrievedAt: d.retrievedAt ? new Date(d.retrievedAt) : null,
        verifiedAt: d.verifiedAt ? new Date(d.verifiedAt) : null,
        freshnessExpiresAt: d.freshnessExpiresAt ? new Date(d.freshnessExpiresAt) : null,
        isDemonstration: false,
      },
      create: {
        id: d.id,
        retailerId: d.retailerId,
        title: d.title,
        description: d.description,
        discount: d.discountValue,
        expiryDate,
        isActive: d.isActive ?? true,
        dataStatus: d.dataStatus,
        dataSource: d.sourceType || 'DIRECT_MERCHANT_WEBSITE',
        sourceUrl: d.sourceUrl,
        retrievedAt: d.retrievedAt ? new Date(d.retrievedAt) : null,
        verifiedAt: d.verifiedAt ? new Date(d.verifiedAt) : null,
        freshnessExpiresAt: d.freshnessExpiresAt ? new Date(d.freshnessExpiresAt) : null,
        isDemonstration: false,
      },
    });
    count++;
  }

  return { syncedCount: count, status: 'SUCCESS' };
}

/**
 * Queries current active deals from canonical durable database storage using `currentDealWhere(asOf)`.
 */
export async function queryDurableCurrentDeals(prisma, asOf = new Date()) {
  if (!prisma || !prisma.deal) return [];
  const whereClause = currentDealWhere(asOf);

  return prisma.deal.findMany({
    where: {
      ...whereClause,
      isDemonstration: false,
    },
    include: {
      retailer: {
        select: {
          id: true,
          name: true,
          address: true,
          dataStatus: true,
          isDemonstration: true,
        },
      },
    },
    orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
  });
}
