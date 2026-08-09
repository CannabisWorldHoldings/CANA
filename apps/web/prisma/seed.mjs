import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password.mjs';
import {
  createBootstrapCredentials,
  writeBootstrapCredentialFile,
} from '../src/lib/auth/bootstrap-credentials.mjs';
import { assertSeedTargetIsSafe } from './seed-safety.mjs';
const prisma = new PrismaClient();

const DEMONSTRATION_PROVENANCE = {
  dataStatus: 'DEMONSTRATION_ONLY',
  dataSource: 'Local development seed',
  sourceUrl: null,
  retrievedAt: null,
  verifiedAt: null,
  freshnessExpiresAt: null,
  confidence: 0,
  reviewedBy: null,
  isDemonstration: true,
};

async function main() {
  // HARD SAFETY GATE, before anything else. This seed DELETES most of the
  // schema and inserts DEMONSTRATION_ONLY rows; assertSeedTargetIsSafe throws
  // (no override, no flag) unless the target is a safe demonstration substrate
  // — a local SQLite rollback fixture OR an identified disposable LOOPBACK
  // PostgreSQL database (docs/adr/0001) — that contains nothing but
  // demonstration data. See prisma/seed-safety.mjs.
  await assertSeedTargetIsSafe({
    prisma,
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    disposableSystemIdentifier: process.env.CANA_DISPOSABLE_DATABASE_SYSTEM_IDENTIFIER,
  });

  const bootstrapCredentials = createBootstrapCredentials();
  const credentialPath = writeBootstrapCredentialFile(bootstrapCredentials);

  console.log('Clearing database...');
  await prisma.authFailure.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.leadEvent.deleteMany({});
  await prisma.loyaltyTransaction.deleteMany({});
  await prisma.loyaltyAccount.deleteMany({});
  await prisma.article.deleteMany({});
  await prisma.deal.deleteMany({});
  await prisma.brandMenu.deleteMany({});
  await prisma.menuEntry.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.claimRequest.deleteMany({});
  await prisma.licenseEvidence.deleteMany({});
  await prisma.retailer.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.brand.deleteMany({});
  await prisma.organization.deleteMany({});

  console.log('Seeding parent organization...');
  const org = await prisma.organization.create({
    data: {
      name: 'Order Weed DC Demonstration Holding Company',
    },
  });

  console.log('Seeding 10 brand subdomains...');
  const brandsData = [
    {
      name: 'orderweeddc',
      domain: 'orderweeddc.localhost',
      description: 'Demonstration catalog for the orderweeddc directory experience. All local listings are synthetic.',
      themePrimary: '#0e9f5a',
      themeSecondary: '#0a7443',
    },
    {
      name: 'GreenDeals DC',
      domain: 'deals.localhost',
      description: 'Demonstration catalog of synthetic deals and offer layouts.',
      themePrimary: '#F97316',
      themeSecondary: '#C2410C',
    },
    {
      name: 'Elixir Luxury Cannabis',
      domain: 'luxury.localhost',
      description: 'Demonstration catalog for premium product discovery layouts.',
      themePrimary: '#8B5CF6',
      themeSecondary: '#6D28D9',
    },
    {
      name: 'BudBudget DC',
      domain: 'value.localhost',
      description: 'Demonstration catalog for value-product and deal layouts.',
      themePrimary: '#3B82F6',
      themeSecondary: '#1D4ED8',
    },
    {
      name: 'DC Flower Exchange',
      domain: 'flower.localhost',
      description: 'Demonstration flower catalog using synthetic product and availability data.',
      themePrimary: '#10B981',
      themeSecondary: '#047857',
    },
    {
      name: 'Nectar Edibles',
      domain: 'edibles.localhost',
      description: 'Demonstration edibles catalog using synthetic product data.',
      themePrimary: '#EC4899',
      themeSecondary: '#BE185D',
    },
    {
      name: 'Prana CBD & Wellness',
      domain: 'wellness.localhost',
      description: 'Demonstration wellness catalog; content is not medical advice.',
      themePrimary: '#14B8A6',
      themeSecondary: '#0F766E',
    },
    {
      name: 'Gear & Glass DC',
      domain: 'accessories.localhost',
      description: 'Demonstration accessories catalog using synthetic product data.',
      themePrimary: '#6366F1',
      themeSecondary: '#4338CA',
    },
    {
      name: 'HighCulture Events',
      domain: 'events.localhost',
      description: 'Demonstration editorial and events layout; drafts are not current guidance.',
      themePrimary: '#EAB308',
      themeSecondary: '#A16207',
    },
    {
      name: 'WeedIntelligence',
      domain: 'biz.localhost',
      description: 'Demonstration business analytics interface using synthetic metrics.',
      themePrimary: '#64748B',
      themeSecondary: '#475569',
    },
  ];

  const brands = [];
  for (const b of brandsData) {
    const brand = await prisma.brand.create({
      data: {
        ...b,
        organizationId: org.id,
      },
    });
    brands.push(brand);
  }

  console.log('Seeding administrative users...');
  await prisma.user.create({
    data: {
      email: 'admin@orderweeddc.com',
      password: await hashPassword(bootstrapCredentials.ADMIN.password),
      name: 'System Admin',
      role: 'ADMIN',
    },
  });

  console.log('Seeding Master Product Database...');
  const productsData = [
    { name: 'Blue Dream', category: 'flower', strainType: 'hybrid', thcPercent: 20.1, cbdPercent: 0.2, description: 'Sativa-dominant hybrid strain known for its sweet berry aroma and uplifting effects.' },
    { name: 'Sour Diesel', category: 'flower', strainType: 'sativa', thcPercent: 22.5, cbdPercent: 0.1, description: 'Fast-acting, energizing sativa strain with a pungent diesel aroma.' },
    { name: 'OG Kush', category: 'flower', strainType: 'hybrid', thcPercent: 19.8, cbdPercent: 0.3, description: 'Classic indica-leaning hybrid providing full-body relaxation and relief.' },
    { name: 'Granddaddy Purple', category: 'flower', strainType: 'indica', thcPercent: 23.0, cbdPercent: 0.1, description: 'Famous indica strain with grape and berry flavors, ideal for night-time use.' },
    { name: 'Wana Sour Gummies (100mg)', category: 'edibles', strainType: 'hybrid', thcPercent: 10.0, cbdPercent: 0.0, description: 'Assorted sour gummies, 10mg THC per gummy, 10 gummies per pack.' },
    { name: 'Wyld Huckleberry Gummies (100mg)', category: 'edibles', strainType: 'hybrid', thcPercent: 10.0, cbdPercent: 0.0, description: 'Real fruit huckleberry hybrid gummies. 100mg total THC.' },
    { name: 'Raw Garden Live Resin Cartridge', category: 'concentrates', strainType: 'hybrid', thcPercent: 82.3, cbdPercent: 1.5, description: 'Premium 1g live resin cartridge with full-spectrum terpenes.' },
    { name: 'Pax 3 Vaporizer', category: 'accessories', strainType: 'accessories', thcPercent: 0.0, cbdPercent: 0.0, description: 'Dual-use portable vaporizer for dry herb and concentrates.' },
  ];

  const products = [];
  for (const p of productsData) {
    const prod = await prisma.product.create({
      data: {
        ...p,
        ...DEMONSTRATION_PROVENANCE,
      },
    });
    products.push(prod);
  }

  console.log('Seeding Retailers & Locations...');
  const retailersData = [
    {
      name: 'Demo Retailer Alpha',
      type: 'delivery',
      address: '100 Demo Avenue NW',
      city: 'Washington',
      state: 'DC',
      zip: '20009',
      lat: 38.9169,
      lng: -77.0322,
      phone: '202-555-0199',
      hours: '10:00 AM - 10:00 PM',
      hoursSource: 'Synthetic development seed',
      licenseStatus: 'UNVERIFIED',
      licenseNumber: null,
      isSponsored: true,
    },
    {
      name: 'Demo Retailer Beta',
      type: 'delivery',
      address: '200 Demo Avenue NW',
      city: 'Washington',
      state: 'DC',
      zip: '20001',
      lat: 38.9025,
      lng: -77.0219,
      phone: '202-555-0144',
      hours: '9:00 AM - 9:00 PM',
      hoursSource: 'Synthetic development seed',
      licenseStatus: 'UNVERIFIED',
      licenseNumber: null,
      isSponsored: false,
    },
    {
      name: 'Demo Retailer Gamma',
      type: 'delivery',
      address: '300 Demo Avenue NW',
      city: 'Washington',
      state: 'DC',
      zip: '20004',
      lat: 38.8972,
      lng: -77.0282,
      phone: '202-555-0188',
      hours: '11:00 AM - 9:00 PM',
      hoursSource: 'Synthetic development seed',
      licenseStatus: 'UNVERIFIED',
      licenseNumber: null,
      isSponsored: true,
    },
    {
      name: 'Demo Retailer Delta',
      type: 'storefront',
      address: '400 Demo Avenue NW',
      city: 'Washington',
      state: 'DC',
      zip: '20009',
      lat: 38.9162,
      lng: -77.0319,
      phone: '202-555-0166',
      hours: '10:00 AM - 8:00 PM',
      hoursSource: 'Synthetic development seed',
      licenseStatus: 'UNVERIFIED',
      licenseNumber: null,
      isSponsored: false,
    },
    {
      name: 'Demo Retailer Epsilon',
      type: 'delivery',
      address: '500 Demo Avenue SE',
      city: 'Washington',
      state: 'DC',
      zip: '20003',
      lat: 38.8872,
      lng: -76.9989,
      phone: '202-555-0155',
      hours: '24 Hours',
      hoursSource: 'Synthetic development seed',
      licenseStatus: 'UNVERIFIED',
      licenseNumber: null,
      isSponsored: false,
    },
  ];

  // Deterministic, visibly labeled sample prices for demonstration menu
  // entries. The UI renders these as "Sample price" with the DEMONSTRATION
  // ONLY badge, and the HTTP truth checks exercise price-band filtering
  // against them. No randomness: identical seeds produce identical data.
  const DEMONSTRATION_SAMPLE_PRICES = {
    'Blue Dream': 38,
    'Sour Diesel': 42,
    'OG Kush': 45,
    'Granddaddy Purple': 40,
    'Wana Sour Gummies (100mg)': 22,
    'Wyld Huckleberry Gummies (100mg)': 24,
    'Raw Garden Live Resin Cartridge': 55,
    'Pax 3 Vaporizer': 199,
  };

  const seededRetailers = [];
  for (const [retailerIndex, r] of retailersData.entries()) {
    const ret = await prisma.retailer.create({
      data: {
        ...r,
        ...DEMONSTRATION_PROVENANCE,
        lastLicenseCheck: null,
        lastInfoCheck: null,
        menuUpdatedAt: null,
        dealUpdatedAt: null,
      },
    });
    seededRetailers.push(ret);

    // Seed menu entries for each retailer
    console.log(`Seeding menu for ${ret.name}...`);
    for (const p of products) {
      // Accessories only for accessories, CBD/Edibles/Flower randomly assigned
      if (p.category === 'accessories' && retailerIndex !== 2 && retailerIndex !== 3) {
        continue;
      }
      
      const menuEntry = await prisma.menuEntry.create({
        data: {
          retailerId: ret.id,
          productId: p.id,
          // Sample values stay visibly synthetic via DEMONSTRATION_ONLY
          // labels; zeroed prices rendered as broken data instead of
          // labeled samples.
          price: DEMONSTRATION_SAMPLE_PRICES[p.name] ?? 0,
          quantity: 25,
          inStock: true,
          ...DEMONSTRATION_PROVENANCE,
        },
      });

      // Link menu entries to Brand configurations (dynamic visibility)
      for (const brand of brands) {
        // Main portal gets everything
        if (brand.domain === 'orderweeddc.localhost') {
          await prisma.brandMenu.create({
            data: {
              brandId: brand.id,
              menuEntryId: menuEntry.id,
            },
          });
        }
        // Specific brands filter based on category
        else if (brand.domain === 'flower.localhost' && p.category === 'flower') {
          await prisma.brandMenu.create({
            data: {
              brandId: brand.id,
              menuEntryId: menuEntry.id,
            },
          });
        }
        else if (brand.domain === 'edibles.localhost' && p.category === 'edibles') {
          await prisma.brandMenu.create({
            data: {
              brandId: brand.id,
              menuEntryId: menuEntry.id,
            },
          });
        }
        else if (brand.domain === 'wellness.localhost' && (p.category === 'edibles' || p.category === 'flower') && p.strainType === 'cbd') {
          await prisma.brandMenu.create({
            data: {
              brandId: brand.id,
              menuEntryId: menuEntry.id,
            },
          });
        }
        else if (brand.domain === 'accessories.localhost' && p.category === 'accessories') {
          await prisma.brandMenu.create({
            data: {
              brandId: brand.id,
              menuEntryId: menuEntry.id,
            },
          });
        }
        else if (brand.domain === 'deals.localhost' || brand.domain === 'luxury.localhost' || brand.domain === 'value.localhost') {
          // Deals, Luxury, and Value platforms also display items
          await prisma.brandMenu.create({
            data: {
              brandId: brand.id,
              menuEntryId: menuEntry.id,
            },
          });
        }
      }
    }

    // Deals seeding has been remediated and removed to avoid polluting metrics
    // with synthetic discounts and promotions on unverified seed retailers.

    // One synthetic queue item exercises the review UI without claiming verification.
    if (retailerIndex === 0) {
      await prisma.licenseEvidence.create({
        data: {
          retailerId: ret.id,
          documentUrl: '/evidence/demo-license-placeholder.pdf',
          verificationStatus: 'PENDING',
          notes: 'Synthetic demonstration evidence. It must never approve a public license state.',
          ...DEMONSTRATION_PROVENANCE,
        },
      });
    }
  }

  const managedRetailer = seededRetailers[0];
  if (!managedRetailer) {
    throw new Error('Demonstration manager requires a seeded retailer.');
  }

  await prisma.user.create({
    data: {
      email: 'retailer@orderweeddc.com',
      password: await hashPassword(
        bootstrapCredentials.RETAILER_MANAGER.password,
      ),
      name: 'Demo Retailer Manager',
      role: 'RETAILER_MANAGER',
      managedRetailerId: managedRetailer.id,
    },
  });

  console.log('Seeding customer user and shared loyalty points ledger...');
  const customer = await prisma.user.create({
    data: {
      email: 'customer@orderweeddc.com',
      password: await hashPassword(bootstrapCredentials.CUSTOMER.password),
      name: 'Jane Doe',
      role: 'CUSTOMER',
    },
  });

  const mainBrand = brands.find(b => b.domain === 'orderweeddc.localhost');
  const dealsBrand = brands.find(b => b.domain === 'deals.localhost');

  if (mainBrand && dealsBrand) {
    const mainLoyalty = await prisma.loyaltyAccount.create({
      data: {
        userId: customer.id,
        brandId: mainBrand.id,
        points: 250,
        tier: 'SILVER',
      },
    });

    await prisma.loyaltyTransaction.createMany({
      data: [
        { loyaltyAccountId: mainLoyalty.id, pointsChanged: 100, description: 'SignUp Welcome Reward' },
        { loyaltyAccountId: mainLoyalty.id, pointsChanged: 150, description: 'Route Handoff Order Reward' },
      ],
    });

    const dealsLoyalty = await prisma.loyaltyAccount.create({
      data: {
        userId: customer.id,
        brandId: dealsBrand.id,
        points: 50,
        tier: 'BRONZE',
      },
    });

    await prisma.loyaltyTransaction.create({
      data: {
        loyaltyAccountId: dealsLoyalty.id,
        pointsChanged: 50,
        description: 'SignUp Welcome Reward',
      },
    });
  }

  console.log('Seeding educational articles...');
  await prisma.article.createMany({
    data: [
      {
        title: 'Understanding Cannabis Terpenes: A Local Guide',
        slug: 'understanding-terpenes',
        content: 'Demonstration editorial draft. This placeholder shows how an educational article would be presented after source review. It is not medical, legal, safety, or regulatory guidance.',
        ...DEMONSTRATION_PROVENANCE,
      },
      {
        title: 'How D.C. Medical Cannabis Licensing Works',
        slug: 'dc-licensing-guide',
        content: 'Demonstration editorial draft. Licensing rules and business status can change; consult the relevant D.C. government source before publishing or acting on this content.',
        ...DEMONSTRATION_PROVENANCE,
      },
    ],
  });

  console.log(`Seeding finished successfully. Local access details: ${credentialPath}`);
  console.log('No password was printed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
