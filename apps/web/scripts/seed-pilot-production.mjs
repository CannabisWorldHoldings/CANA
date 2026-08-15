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

  // Create/upsert canonical brand under both orderweeddc.localhost and orderweeddc.com
  const brand = await prisma.brand.upsert({
    where: { domain: 'orderweeddc.localhost' },
    update: {
      name: 'OrderWeedDC',
      organizationId: org.id,
    },
    create: {
      id: 'brand-owd-pilot',
      name: 'OrderWeedDC',
      domain: 'orderweeddc.localhost',
      organizationId: org.id,
    },
  });

  const brandApex = await prisma.brand.upsert({
    where: { domain: 'orderweeddc.com' },
    update: {
      name: 'OrderWeedDC Apex',
      organizationId: org.id,
    },
    create: {
      id: 'brand-owd-apex',
      name: 'OrderWeedDC Apex',
      domain: 'orderweeddc.com',
      organizationId: org.id,
    },
  });

  console.log('Brands & Org established:', brand.id, brandApex.id);

  // Ensure a default product exists for menuEntry joining
  const defaultProduct = await prisma.product.upsert({
    where: { id: 'prod-pilot-catalog-item' },
    update: {},
    create: {
      id: 'prod-pilot-catalog-item',
      name: 'Verified Medical Cannabis Flower',
      category: 'Flower',
      dataStatus: 'VERIFIED_CURRENT',
      isDemonstration: false,
    },
  });

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

    // Check if menuEntry exists
    let menuEntry = await prisma.menuEntry.findFirst({
      where: { retailerId: retailer.id, productId: defaultProduct.id },
    });

    if (!menuEntry) {
      menuEntry = await prisma.menuEntry.create({
        data: {
          retailerId: retailer.id,
          productId: defaultProduct.id,
          price: 50.0,
          inStock: true,
          dataStatus: 'VERIFIED_CURRENT',
          isDemonstration: false,
        },
      });
    }

    // Link menuEntry to both brands
    for (const b of [brand, brandApex]) {
      const existingBrandMenu = await prisma.brandMenu.findUnique({
        where: { brandId_menuEntryId: { brandId: b.id, menuEntryId: menuEntry.id } },
      });

      if (!existingBrandMenu) {
        await prisma.brandMenu.create({
          data: {
            brandId: b.id,
            menuEntryId: menuEntry.id,
          },
        });
      }
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
