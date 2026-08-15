import { PrismaClient } from '@prisma/client';
import { PILOT_MERCHANTS, LIVE_PROMOTIONAL_OFFERS } from '../src/lib/reality/market-reality-pilot.mjs';
import { syncLiveDealsToDurableStore } from '../src/lib/reality/promotional-revalidation.mjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding pilot retailers, brands, and live deals...');

  const org = await prisma.organization.upsert({
    where: { id: 'org-owd-pilot' },
    update: { name: 'OrderWeedDC Org' },
    create: {
      id: 'org-owd-pilot',
      name: 'OrderWeedDC Org',
    },
  });

  const brand = await prisma.brand.upsert({
    where: { domain: 'orderweeddc.com' },
    update: {
      name: 'OrderWeedDC',
      organizationId: org.id,
    },
    create: {
      id: 'brand-owd-pilot',
      name: 'OrderWeedDC',
      domain: 'orderweeddc.com',
      organizationId: org.id,
    },
  });

  console.log('Brand & Org established:', brand.id, brand.domain);

  for (const m of PILOT_MERCHANTS) {
    const retailer = await prisma.retailer.upsert({
      where: { id: m.retailerId },
      update: {
        name: m.officialName,
        type: 'DISPENSARY',
        address: m.address,
        city: m.city,
        state: m.state,
        zip: m.zip,
        lat: m.lat,
        lng: m.lng,
        website: m.canonicalWebsite,
        dataStatus: 'VERIFIED_CURRENT',
        isDemonstration: false,
        verifiedAt: new Date(m.verifiedAt),
        freshnessExpiresAt: new Date(m.freshnessExpiresAt),
      },
      create: {
        id: m.retailerId,
        name: m.officialName,
        type: 'DISPENSARY',
        address: m.address,
        city: m.city,
        state: m.state,
        zip: m.zip,
        lat: m.lat,
        lng: m.lng,
        website: m.canonicalWebsite,
        dataStatus: 'VERIFIED_CURRENT',
        isDemonstration: false,
        verifiedAt: new Date(m.verifiedAt),
        freshnessExpiresAt: new Date(m.freshnessExpiresAt),
      },
    });

    // Check if menu exists
    let menu = await prisma.menu.findFirst({
      where: { retailerId: retailer.id },
    });

    if (!menu) {
      menu = await prisma.menu.create({
        data: {
          retailerId: retailer.id,
          name: `${m.officialName} Live Menu`,
        },
      });
    }

    // Link menu to brand
    const brandMenu = await prisma.brandMenu.findFirst({
      where: { brandId: brand.id, menuEntryId: menu.id },
    });

    if (!brandMenu) {
      await prisma.brandMenu.create({
        data: {
          brandId: brand.id,
          menuEntryId: menu.id,
        },
      });
    }
  }

  const syncResult = await syncLiveDealsToDurableStore(prisma, LIVE_PROMOTIONAL_OFFERS);
  console.log('Sync Live Deals Result:', syncResult);

  const finalDealCount = await prisma.deal.count({
    where: { isActive: true, isDemonstration: false },
  });
  console.log(`Verified Real Deals in DB: ${finalDealCount}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed Error:', err);
  process.exit(1);
});
