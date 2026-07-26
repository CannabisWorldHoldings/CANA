import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  assertRetailerManager,
  destroySession,
  requireRetailerManager,
} from '@/lib/auth/session';
import {
  addRetailerMenuItem,
  createRetailerDeal,
  updateRetailerMenuEntry,
  updateRetailerProfile,
} from '@/lib/merchant-mutations.mjs';
import {
  MERCHANT_CATALOG_QUERY_MAX_LENGTH,
  MERCHANT_PAGE_SIZE,
  availableCatalogWhere,
  clampMerchantPage,
  merchantDashboardHref,
  merchantPageCount,
  merchantPageOffset,
  parseMerchantDashboardSearch,
} from '@/lib/merchant-dashboard.mjs';

export const dynamic = 'force-dynamic';

type CollectionKey = 'menuPage' | 'dealPage' | 'catalogPage';

type MerchantSearch = Record<CollectionKey, number> & {
  catalogQuery: string;
};

type Props = {
  searchParams: Promise<
    Partial<
      Record<CollectionKey | 'catalogQuery', string | string[]>
    >
  >;
};

function DashboardPagination({
  search,
  pageKey,
  totalItems,
}: {
  search: MerchantSearch;
  pageKey: CollectionKey;
  totalItems: number;
}) {
  const currentPage = search[pageKey];
  const totalPages = merchantPageCount(totalItems);
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={`${pageKey} pagination`}
      className="flex items-center justify-between gap-3 border-t border-white/5 pt-3 text-xs"
    >
      {currentPage > 1 ? (
        <Link
          href={merchantDashboardHref(search, pageKey, currentPage - 1)}
          className="font-bold text-[#1EC36A] hover:underline"
        >
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-slate-500">
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link
          href={merchantDashboardHref(search, pageKey, currentPage + 1)}
          className="font-bold text-[#1EC36A] hover:underline"
        >
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export default async function BusinessDashboardPage({ searchParams }: Props) {
  const managerSession = await requireRetailerManager();
  const retailerId = managerSession.managedRetailerId ?? redirect('/business/login');
  const requestedSearch = parseMerchantDashboardSearch(await searchParams);

  // 1. Fetch retailer profile
  const retailer = await prisma.retailer.findUnique({
    where: { id: retailerId },
    select: {
      name: true,
      address: true,
      phone: true,
      hours: true,
      hoursSource: true,
      licenseStatus: true,
      isDemonstration: true,
    },
  });

  if (!retailer) {
    return (
      <div className="min-h-screen bg-[#0B0F12] text-brand-text flex flex-col justify-center items-center p-8">
        <p className="text-red-500 font-bold">Error: Business profile not found.</p>
        <Link href="/business/login" className="mt-4 text-[#1EC36A] hover:underline">
          Go back to Login
        </Link>
      </div>
    );
  }

  const catalogWhere = availableCatalogWhere(
    retailerId,
    requestedSearch.catalogQuery,
  );
  const [menuCount, dealCount, availableProductCount, handoffCount] =
    await Promise.all([
      prisma.menuEntry.count({ where: { retailerId } }),
      prisma.deal.count({ where: { retailerId } }),
      prisma.product.count({ where: catalogWhere }),
      prisma.leadEvent.count({
        where: { retailerId, eventType: 'HANDOFF_CLICK' },
      }),
    ]);

  const search: MerchantSearch = {
    menuPage: clampMerchantPage(requestedSearch.menuPage, menuCount),
    dealPage: clampMerchantPage(requestedSearch.dealPage, dealCount),
    catalogPage: clampMerchantPage(
      requestedSearch.catalogPage,
      availableProductCount,
    ),
    catalogQuery: requestedSearch.catalogQuery,
  };

  const [menuEntries, deals, availableProducts, leads] = await Promise.all([
    prisma.menuEntry.findMany({
      where: { retailerId },
      select: {
        id: true,
        price: true,
        quantity: true,
        product: {
          select: {
            name: true,
            category: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: merchantPageOffset(search.menuPage),
      take: MERCHANT_PAGE_SIZE,
    }),
    prisma.deal.findMany({
      where: { retailerId },
      select: {
        id: true,
        title: true,
        discount: true,
        expiryDate: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: merchantPageOffset(search.dealPage),
      take: MERCHANT_PAGE_SIZE,
    }),
    prisma.product.findMany({
      where: catalogWhere,
      select: {
        id: true,
        name: true,
        category: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: merchantPageOffset(search.catalogPage),
      take: MERCHANT_PAGE_SIZE,
    }),
    prisma.leadEvent.findMany({
      where: { retailerId },
      select: {
        id: true,
        eventType: true,
        createdAt: true,
        brand: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  // Server Action: Update Business Profile
  async function updateProfile(formData: FormData) {
    'use server';
    const manager = await assertRetailerManager(retailerId);
    await updateRetailerProfile(prisma, {
      retailerId,
      actorUserId: manager.userId,
      input: {
        name: formData.get('name'),
        address: formData.get('address'),
        phone: formData.get('phone'),
        hours: formData.get('hours'),
        hoursSource: formData.get('hoursSource'),
      },
    });

    revalidatePath(`/business/dashboard`);
  }

  // Server Action: Update menu item price and bounded inventory quantity
  async function updateMenuEntry(formData: FormData) {
    'use server';
    const manager = await assertRetailerManager(retailerId);
    await updateRetailerMenuEntry(prisma, {
      retailerId,
      actorUserId: manager.userId,
      input: {
        menuEntryId: formData.get('menuEntryId'),
        price: formData.get('price'),
        quantity: formData.get('quantity'),
      },
    });

    revalidatePath(`/business/dashboard`);
  }

  // Server Action: Add product from master catalog
  async function addMenuItem(formData: FormData) {
    'use server';
    const manager = await assertRetailerManager(retailerId);
    await addRetailerMenuItem(prisma, {
      retailerId,
      actorUserId: manager.userId,
      input: {
        productId: formData.get('productId'),
        price: formData.get('price'),
        quantity: formData.get('quantity'),
      },
    });

    revalidatePath(`/business/dashboard`);
  }

  // Server Action: Create active promo deal
  async function createDeal(formData: FormData) {
    'use server';
    const manager = await assertRetailerManager(retailerId);
    await createRetailerDeal(prisma, {
      retailerId,
      actorUserId: manager.userId,
      input: {
        title: formData.get('title'),
        discount: formData.get('discount'),
        code: formData.get('code'),
        days: formData.get('days'),
        description: formData.get('description'),
      },
    });

    revalidatePath(`/business/dashboard`);
  }

  async function logout() {
    'use server';
    await assertRetailerManager(retailerId);
    await destroySession();
    redirect('/business/login');
  }

  return (
    <div className="min-h-screen bg-[#0B0F12] text-brand-text animate-fade-in">
      {retailer.isDemonstration && (
        <div className="border-b border-violet-400/30 bg-violet-400/10 px-4 py-3 text-center text-xs font-semibold text-violet-200">
          Demonstration retailer: changes remain synthetic and cannot create a verified public record.
        </div>
      )}
      {/* Top Header */}
      <header className="border-b border-white/5 bg-[#141A1E] py-4 px-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <span className="bg-[#1EC36A] text-black font-extrabold text-[10px] px-2.5 py-1 rounded">
              PARTNER STORE
            </span>
            <h1 className="text-xl font-bold text-brand-text">{retailer.name} Dashboard</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded border ${
              retailer.licenseStatus === 'VERIFIED'
                ? 'bg-brand-primary/10 border-brand-primary/20 text-brand-primary-text'
                : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
            }`}>
              License Status: {retailer.licenseStatus}
            </span>
            <form action={logout}>
              <button type="submit" className="text-xs text-slate-600 hover:text-brand-text transition-colors">
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Columns (Menu & Deals) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Inventory Manager */}
          <div className="border border-white/5 bg-[#141A1E] rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-brand-text flex items-center">
              📦 Menu Inventory Management
            </h2>

            <form
              method="get"
              action="/business/dashboard"
              className="flex flex-wrap items-end gap-3 border-b border-white/5 pb-4"
            >
              {search.menuPage > 1 && (
                <input type="hidden" name="menuPage" value={search.menuPage} />
              )}
              {search.dealPage > 1 && (
                <input type="hidden" name="dealPage" value={search.dealPage} />
              )}
              <div className="min-w-[220px] flex-grow">
                <label
                  htmlFor="catalog-query"
                  className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5"
                >
                  Find a catalog product
                </label>
                <input
                  id="catalog-query"
                  name="catalogQuery"
                  defaultValue={search.catalogQuery}
                  maxLength={MERCHANT_CATALOG_QUERY_MAX_LENGTH}
                  placeholder="Search name, category, or description"
                  className="w-full bg-[#0B0F12] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none focus:border-[#1EC36A]"
                />
              </div>
              <button
                type="submit"
                className="border border-white/10 text-slate-200 font-bold text-xs px-4 py-2 rounded hover:bg-white/5"
              >
                Search Catalog
              </button>
              {search.catalogQuery && (
                <Link
                  href={merchantDashboardHref(
                    { ...search, catalogQuery: '' },
                    'catalogPage',
                    1,
                  )}
                  className="py-2 text-xs font-bold text-slate-600 hover:text-brand-text"
                >
                  Clear
                </Link>
              )}
            </form>

            {/* Add menu item form */}
            {availableProducts.length > 0 && (
              <form action={addMenuItem} className="bg-[#0B0F12] border border-white/5 p-4 rounded-md flex flex-wrap items-end gap-3">
                <div className="flex-grow min-w-[200px]">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Link Global Product
                  </label>
                  <select name="productId" required className="w-full bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none focus:border-[#1EC36A]">
                    {availableProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.category})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Price ($)
                  </label>
                  <input name="price" type="number" min="0.01" max="10000" step="0.01" defaultValue="55.00" required className="w-full bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none focus:border-[#1EC36A]" />
                </div>
                <div className="w-24">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Quantity
                  </label>
                  <input name="quantity" type="number" min="0" max="100000" step="1" defaultValue="1" required className="w-full bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none focus:border-[#1EC36A]" />
                </div>
                <button type="submit" className="bg-[#1EC36A] text-black font-extrabold text-xs px-4 py-2.5 rounded hover:bg-opacity-90">
                  Add Item
                </button>
              </form>
            )}
            <div className="text-[10px] text-slate-500">
              {availableProductCount} catalog product
              {availableProductCount === 1 ? '' : 's'} match and are not already
              on this retailer&apos;s menu.
            </div>
            <DashboardPagination
              search={search}
              pageKey="catalogPage"
              totalItems={availableProductCount}
            />

            {/* Current Menu Table */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-600">
                Current Items ({menuCount})
              </h3>
              
              {menuEntries.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No menu items configured. Add items from the catalog above.</p>
              ) : (
                <div className="space-y-3">
                  {menuEntries.map((entry) => (
                    <form key={entry.id} action={updateMenuEntry} className="bg-[#0B0F12] border border-white/5 p-3 rounded flex justify-between items-center gap-4">
                      <input type="hidden" name="menuEntryId" value={entry.id} />
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-brand-text">{entry.product.name}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{entry.product.category}</div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <span>$</span>
                          <input 
                            name="price" 
                            type="number" 
                            min="0.01"
                            max="10000"
                            step="0.01" 
                            defaultValue={entry.price.toFixed(2)} 
                            required
                            className="bg-[#141A1E] border border-white/10 w-16 px-1.5 py-1 rounded text-center text-brand-text text-xs focus:outline-none focus:border-[#1EC36A]"
                          />
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <span>Qty</span>
                          <input
                            name="quantity"
                            type="number"
                            min="0"
                            max="100000"
                            step="1"
                            defaultValue={entry.quantity ?? ''}
                            required
                            className="bg-[#141A1E] border border-white/10 w-20 px-1.5 py-1 rounded text-center text-brand-text text-xs focus:outline-none focus:border-[#1EC36A]"
                          />
                        </div>

                        <button type="submit" className="text-[#1EC36A] hover:underline text-xs font-bold px-2">
                          Save
                        </button>
                      </div>
                    </form>
                  ))}
                </div>
              )}
              <DashboardPagination
                search={search}
                pageKey="menuPage"
                totalItems={menuCount}
              />
            </div>
          </div>

          {/* Deals Creator */}
          <div className="border border-white/5 bg-[#141A1E] rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-brand-text flex items-center">
              🔥 Create Promotions & Deals
            </h2>

            <form action={createDeal} className="space-y-4 bg-[#0B0F12] border border-white/5 p-4 rounded-md">
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Deal Title
                  </label>
                  <input name="title" required minLength={2} maxLength={120} placeholder="e.g. Free pre-roll on orders > $60" className="w-full bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Discount Label
                  </label>
                  <input name="discount" required maxLength={80} placeholder="e.g. 15% OFF, FREE PRE-ROLL" className="w-full bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Promo Code (Optional)
                  </label>
                  <input name="code" maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="e.g. SAVE15" className="w-full bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Duration (Days Active)
                  </label>
                  <input name="days" type="number" min="1" max="90" step="1" defaultValue="7" required className="w-full bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Deal Details / Description
                </label>
                <textarea name="description" maxLength={1000} placeholder="Provide clear descriptions of what items are included." className="w-full h-16 bg-[#141A1E] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
              </div>

              <button type="submit" className="bg-[#1EC36A] text-black font-extrabold text-xs px-4 py-2.5 rounded hover:bg-opacity-90">
                Publish Active Deal
              </button>
            </form>

            {/* Listing active deals */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-600">
                Submitted Offers ({dealCount})
              </h3>
              {deals.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">No active deals published.</p>
              ) : (
                <div className="space-y-2">
                  {deals.map((deal) => (
                    <div key={deal.id} className="text-xs border border-white/5 bg-[#0B0F12] p-3 rounded flex justify-between items-center">
                      <div>
                        <div className="font-bold text-brand-text">{deal.title}</div>
                        <div className="text-[10px] text-slate-500">
                          Expires: {new Date(deal.expiryDate).toLocaleDateString()}
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold text-[#1EC36A] bg-[#1EC36A]/10 border border-[#1EC36A]/20 px-2.5 py-1 rounded uppercase tracking-wider">
                        {deal.discount}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <DashboardPagination
                search={search}
                pageKey="dealPage"
                totalItems={dealCount}
              />
            </div>
          </div>

        </div>

        {/* Right Columns (Profile & Lead counts) */}
        <div className="space-y-8">
          
          {/* Profile Corrections Editor */}
          <div className="border border-white/5 bg-[#141A1E] rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              ✏️ Profile Listing Settings
            </h2>

            <form action={updateProfile} className="space-y-4">
              
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Business Name
                </label>
                <input name="name" required minLength={2} maxLength={120} defaultValue={retailer.name} className="w-full bg-[#0B0F12] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Storefront Address
                </label>
                <input name="address" required minLength={5} maxLength={240} defaultValue={retailer.address} className="w-full bg-[#0B0F12] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Phone Number
                </label>
                <input name="phone" type="tel" maxLength={32} defaultValue={retailer.phone || ''} className="w-full bg-[#0B0F12] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Operating Hours
                  </label>
                  <input name="hours" required maxLength={120} defaultValue={retailer.hours} className="w-full bg-[#0B0F12] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                    Hours Source
                  </label>
                  <input name="hoursSource" required minLength={2} maxLength={120} defaultValue={retailer.hoursSource} className="w-full bg-[#0B0F12] border border-white/10 rounded px-2.5 py-2 text-xs focus:outline-none" />
                </div>
              </div>

              <button type="submit" className="w-full bg-brand-surface border border-white/10 text-brand-text font-extrabold text-xs py-2.5 rounded hover:bg-white/5 active:scale-98 transition-all">
                Save Listing Updates
              </button>
            </form>
          </div>

          {/* Lead Analytics Monitor */}
          <div className="border border-white/5 bg-[#141A1E] rounded-lg p-6 space-y-4">
            <h2 className="text-md font-bold text-brand-text flex items-center">
              📈 Lead Handoff Attribution
            </h2>
            <div className="bg-[#0B0F12] p-4 rounded-md border border-white/5 text-center">
              <div className="text-2xl font-black text-[#1EC36A]">{handoffCount}</div>
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider pt-0.5">
                Total Route Handoff Clicks
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-600">Recent Referrals</h3>
              {leads.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">No click handoffs tracked yet.</p>
              ) : (
                <div className="space-y-2">
                  {leads.map((lead) => (
                    <div key={lead.id} className="text-[10px] border-b border-white/5 pb-2 flex justify-between">
                      <div>
                        Referral via <span className="font-semibold text-brand-text">{lead.brand.name}</span>
                      </div>
                      <span className="text-slate-500">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}
