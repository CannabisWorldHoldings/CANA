# ORDERWEEDDC customer-side sovereign UI review evidence

Status: review candidate implemented; unmerged owner review pending
Research captured: 2026-08-03 (America/New_York)
Research cutoff: 2026-08-03
Canonical parent: `79bfd9d2936a250035fb2e7d3f47f1d24dc1c0dc`
Canonical parent tree: `d1f1799603784d66ca8a829953d50c6f6cbd171b`

This document separates repository facts, current public-page observations,
implementation decisions, and later verification evidence. It does not claim
production behavior, live marketplace data, paid campaign activity, traffic,
orders, conversion, or revenue.

## 1. Executive findings

- **REPOSITORY VERIFIED:** the canonical customer surface is a Next.js App Router
  tenant application under `apps/web/src/app/[domain]`.
- **REPOSITORY VERIFIED:** the current product already has source, verification,
  freshness, demonstration-data, current-deal, sponsorship-entitlement, customer
  authentication, ordering-handoff, structured-data, SiteMind, and isolated
  business/admin boundaries.
- **REPOSITORY VERIFIED:** the pre-change canonical homepage is data-backed but
  conflicts with the new visual constitution. It uses decorative section borders,
  tinted green surfaces, CSS gradients/glows, glass panels, shadows, and repeated
  bordered card grids.
- **REPOSITORY VERIFIED:** delivery and dispensaries are filters on `/`; neither
  has a dedicated customer discovery route before this branch.
- **REPOSITORY VERIFIED:** deals, products, neighborhoods, education, retailer
  detail, compare, help, legal, customer sign-in, and authenticated wallet routes
  exist. Several are visually noncompliant with this mission, and some features
  remain demonstration-only or incomplete.
- **COMPETITOR PUBLIC PAGE VERIFIED:** current category leaders optimize around a
  small set of customer decisions: location, fulfillment mode, open/closed state,
  menu availability, deal validity, and a direct next action.
- **OFFICIAL SOURCE VERIFIED:** D.C. ABCA distinguishes storefront retailers from
  internet retailers and states that internet retailers deliver only. The UI must
  therefore avoid collapsing every delivery participant into a storefront model.
- **RECOMMENDATION:** select the original **Civic Market Journal** direction: an
  open editorial marketplace with a reserved sponsored banner, a plain-language
  search decision, equal delivery and dispensary chapters, and evidence labels
  kept close to the facts they qualify.

## 2. Pre-implementation current-state truth table

The classification describes the complete customer path supported before this
branch. A route is not called fully working when only its UI exists.

| Route or feature | Pre-change classification | Repository evidence | Truth boundary / gap |
|---|---|---|---|
| `/` customer homepage | PARTIALLY WORKING | `app/[domain]/page.tsx` queries brand-scoped retailers, deals, articles, sponsorship evidence, and renders search/map | Data path exists; visual constitution fails and customer journey is overloaded |
| Dispensary discovery | PARTIALLY WORKING | `/` supports `type=storefront` | No dedicated `/dispensaries`; delivery/dispensary distinction is a select filter |
| Delivery discovery | PARTIALLY WORKING | `/` supports `type=delivery` and a quick shortcut | No dedicated `/delivery`; no service-area, fee, minimum, or ETA evidence model |
| `/products` | PARTIALLY WORKING | Product discovery queries brand menu entries with evidence filters | Product/menu data may be demonstration-only; visual surface is card-heavy |
| `/deals` | PARTIALLY WORKING | Current-deal predicate excludes expired/inactive records; Offer JSON-LD is evidence-gated | No paid-placement banner model; layout is card-wall oriented |
| `/neighborhoods` | PARTIALLY WORKING | Fixed neighborhood configs and deterministic candidate counts | Index is a bordered card grid; coverage is coordinate-window inference, not delivery eligibility |
| `/neighborhoods/[slug]` | PARTIALLY WORKING | Fixed geographic windows, evidence labels, breadcrumbs | Not a proof of service-area compatibility; visual treatment is box-heavy |
| `/education` | PARTIALLY WORKING | Article search and evidence state exist | Seed articles are explicitly demonstration drafts; route name differs from visible “Learn” label |
| `/education/[slug]` | PARTIALLY WORKING | Article detail and structured data exist | Only evidence-eligible content may be treated as current guidance |
| `/retailer/[id]` | PARTIALLY WORKING | Retailer details, menus, current deals, correction, evidence and handoff paths exist | Availability and business status depend on each record; profile styling is visually noncompliant |
| `/retailer/[id]/handoff` | FULLY WORKING | Bounded server route validates a page-bound handoff and records graded attribution | Proves a handoff request, not an order, sale, delivery, or outcome |
| `/compare` | PARTIALLY WORKING | Comparison helper and noindex route exist | Customer tool exists but is not a primary discovery journey |
| Customer search | PARTIALLY WORKING | Homepage retailer query and product filters exist | No unified marketplace search across retailers, products, deals, and neighborhoods |
| Map/list | PARTIALLY WORKING | Retailer map renders coordinate-backed records | No dedicated mobile map/list discovery mode |
| `/customer/login` | FULLY WORKING | Customer-only role gate and session route exist | Current visual label says wallet sign-in; no customer account management page |
| `/wallet` | FULLY WORKING | Authenticated customer route and loyalty data loader exist | Loyalty reflects persisted account data only; no marketplace saved-items view |
| Saved retailers | UI ONLY | `favorite-button.tsx` persists retailer IDs in local storage | No dedicated `/saved` route and no cross-device/account persistence |
| `/help` | PARTIALLY WORKING | Public support route exists | Customer-specific marketplace help is limited |
| `/legal` | PARTIALLY WORKING | FAQ and structured-data truth boundaries exist | Must not be substituted for current official legal advice |
| Sponsorship badges | BACKEND ONLY / PARTIALLY WORKING | Demand-credit entitlement resolves a truthful featured-card disclosure without changing organic order | No primary sponsored banner rail or campaign/media/frequency/fallback model |
| Data source and freshness | FULLY WORKING | Shared data-status and freshness helpers are used on listings | Status proves repository evidence state, not current real-world availability |
| SiteMind | HIDDEN BUT WORKING | Deterministic local audit engine and route registry exist | Route contract does not include dedicated delivery, dispensary, or unified search routes |
| Hermes customer page actions | MISSING | No bounded customer-page action contract found | Must remain proposal-only and must not publish or rewrite JSX directly |
| Business dashboard | FULLY WORKING, OUT OF SCOPE | Separate `/business` layout/auth/dashboard | Must remain unchanged by this customer phase |
| Admin | FULLY WORKING, OUT OF SCOPE | Separate `/admin` layout/auth/site-intelligence | Must not appear as a customer navigation destination |

## 3. Current route map

```text
Public tenant
├── /
├── /dispensaries
├── /delivery
├── /search
├── /products
├── /deals
├── /neighborhoods
│   └── /neighborhoods/[slug]
├── /education
│   └── /education/[slug]
├── /retailer/[id]
│   ├── /retailer/[id]/handoff
│   └── /retailer/[id]/correction
├── /compare
├── /strains
│   └── /strains/[type]
├── /help
├── /legal
├── /pricing
├── /customer/login
└── /wallet

Separate authority surfaces
├── /business/*
└── /admin/*
```

## 4. Competitor evidence index

All observations are mechanism research only. Protected text, visual design,
screenshots, ratings, listing data, logos, and assets are excluded from the build.

| Source | URL | Captured | Window | Evidence class | Page purpose and mechanism observed |
|---|---|---:|---|---|---|
| Where’s Weed D.C. | https://wheresweed.com/washington-dc/ | 2026-08-03 | 72 hours | COMPETITOR PUBLIC PAGE VERIFIED | Location landing page moves from deals to delivery services, dispensaries, editorial and FAQ; content density is high |
| Where’s Weed delivery | https://wheresweed.com/washington-dc/marijuana-delivery | 2026-08-03 | 72 hours | COMPETITOR PUBLIC PAGE VERIFIED | Delivery receives a dedicated list with status, distance, deal count, fee/minimum snippets and direct order CTA |
| Where’s Weed deals | https://wheresweed.com/washington-dc/marijuana-dispensary-deals/recreational | 2026-08-03 | 30 days | COMPETITOR PUBLIC PAGE VERIFIED | Time-sensitive deal browsing with category filters and claim actions; high scan density creates trust and freshness risk |
| Weedmaps D.C. dispensaries | https://weedmaps.com/dispensaries/in/united-states/district-of-columbia/washington | 2026-08-03 | 72 hours | COMPETITOR PUBLIC PAGE VERIFIED | Listing state, medical-only language, order/menu actions, filters, nearby neighborhoods and explanatory content |
| Weedmaps D.C. deals | https://weedmaps.com/deals/united-states/district-of-columbia/washington | 2026-08-03 | 30 days | COMPETITOR PUBLIC PAGE VERIFIED | Dedicated deal intent and distinction between deal display and checkout application |
| Leafly D.C. dispensaries | https://www.leafly.com/dispensaries/district-of-columbia/washington | 2026-08-03 | 72 hours | COMPETITOR PUBLIC PAGE VERIFIED | Strong open/pickup/delivery/deal filters paired with long-form D.C. context |
| Leafly D.C. delivery | https://www.leafly.com/delivery/district-of-columbia/washington | 2026-08-03 | 30 days | COMPETITOR PUBLIC PAGE VERIFIED | Address-led delivery discovery; result snippets prioritize ETA, fee and minimum |
| Dutchie marketplace | https://dutchie.com/ | 2026-08-03 | 72 hours | COMPETITOR PUBLIC PAGE VERIFIED | Location is the first decision; pickup and delivery are explicit modes; real-time menu claims are central |
| Jane marketplace | https://www.iheartjane.com/ | 2026-08-03 | 30 days | PUBLICLY CLAIMED / ACCESS LIMITED | Search surfaced marketplace positioning but no D.C. public page was independently verified in this pass |
| D.C. ABCA retailer locator | https://abca.dc.gov/service/find-medical-cannabis-retailer | 2026-08-03 | 72 hours | OFFICIAL SOURCE VERIFIED | Licensed retailer locator; explicitly distinguishes internet retailers as delivery-only |
| D.C. ABCA endorsements | https://abca.dc.gov/page/medical-cannabis-business-license-endorsements | 2026-08-03 | 30 days | OFFICIAL SOURCE VERIFIED | Defines delivery as an endorsement and documents permitted activity |
| D.C. ABCA March 2026 forms | https://abca.dc.gov/sites/default/files/dc/sites/abra/publication/attachments/Internet%20Retailer%20License%20Instructions_March%202026.pdf | 2026-08-03 | 12 months | OFFICIAL SOURCE VERIFIED | Recent internet-retailer licensing instructions reinforce separate delivery-only business treatment |
| Google Maps cannabis discovery | https://www.google.com/maps/search/cannabis+dispensaries+Washington+DC | 2026-08-03 | 30 days | ACCESS REQUIRED / OUTCOME UNPROVEN | Map-first proximity is a familiar mechanism, but listing licensure and freshness cannot be inferred from a map result |

### Recency interpretation

- **72 hours:** live public pages and the official D.C. locator were recaptured on
  2026-08-03. “Live” means the page responded publicly, not that every listing
  fact was independently corroborated.
- **30 days:** current deal, delivery, and policy pages provide contemporary
  mechanisms. Dynamic counts and availability are deliberately not copied.
- **12 months:** recent D.C. licensing material and market reporting reinforce a
  shift toward licensed medical retail, internet-retailer delivery, and clearer
  hospitality/education contexts. This is directional context, not outcome proof.

## 5. Where’s Weed customer-side deep analysis

### What is effective

- The location homepage puts recognizable customer intents in sequence: search,
  deals, delivery, dispensaries, content, and questions.
- Delivery is not buried inside a generic retailer filter. It receives a named
  homepage rail and a dedicated route.
- Result snippets front-load actionable signals: current status, fulfillment,
  fee/minimum where available, deal count, and order action.
- The owner-supplied visual reference documents a wide advertising position
  directly below navigation. The current text crawl verifies the surrounding
  content sequence but does not independently expose the banner creative or its
  rotation behavior; those visual details remain **OWNER-SUPPLIED REFERENCE**.

### What becomes noisy or risky

- Dense repeated result modules make the page feel like a card wall and compete
  equally for attention.
- Large numbers of ratings, deals, prices, statuses and delivery claims create a
  high freshness burden.
- Delivery listings can visually mix business type, recreational/medical labels,
  fee claims and order states before a customer has supplied an address.
- A marketplace can accidentally make sponsored placement, popularity and
  verification feel equivalent unless each is explicitly separated.

### ORDERWEEDDC mechanism to learn

Use the useful sequence and equal delivery prominence, but reduce every result to
the minimum sourced decision signals. Reserve banner dimensions, label its funding
state, never let it influence verification or organic order, and use whitespace
rather than borders to separate the marketplace chapters.

### What must not be copied

No competitor copy, card geometry, banner creative, review data, listing data,
icons, colors, navigation arrangement, spacing signature, imagery, or trade dress.

## 6. Cross-marketplace comparisons

| Dimension | Current mechanism observed | ORDERWEEDDC decision |
|---|---|---|
| Sponsored banner | Prominent marketplace placements and paid boosts are common; exact disclosure quality varies | One reserved primary rail below navigation; funding/house state disclosed; no effect on verification or organic order |
| Delivery | Dedicated delivery routes work best when location/address precedes eligibility | Give delivery equal navigation and homepage weight; say “confirm service area” until a customer supplies location and evidence supports a match |
| Deals | Dedicated intent pages and expiry signals reduce search cost | Render only current predicate results; show source/freshness; never invent savings or redemption state |
| Dispensaries | Open state, menu access and fulfillment mode dominate scan behavior | Keep only supported status, neighborhood/city, menu/deal availability and source state |
| Products | Category-first discovery reduces initial complexity | Present categories as editorial entry points; product/menu availability remains record-bound |
| Neighborhoods | Local pages work when they add map, access and nearby-service value | Keep fixed, purposeful D.C. guides; never describe coordinate proximity as delivery eligibility |
| Mobile | Location, search, fulfillment mode and filters need to be reachable immediately | Dedicated mobile banner crop, large targets, native disclosure/filter controls, no horizontal overflow |

## 7. Customer information architecture

Primary navigation:

1. Dispensaries
2. Delivery
3. Products
4. Deals
5. Neighborhoods
6. Learn

Utility actions: Search, Washington D.C. location context, Customer Sign In, and a
visually secondary For Businesses link. Admin is absent from customer navigation.

New core routes selected for this branch:

- `/dispensaries`
- `/delivery`
- `/search`

Existing routes retained as canonical rather than duplicated: `/products`,
`/deals`, `/neighborhoods`, `/education`, `/retailer/[id]`, `/customer/login`,
`/help`, and `/legal`.

## 8. Customer journey map

```text
Navigation
  -> disclosed sponsored/house banner
  -> plain-language search or top-level intent
     -> Delivery -> location/service-area caution -> labeled result -> menu/handoff
     -> Dispensaries -> labeled result -> profile/menu -> pickup/handoff
     -> Products -> category -> evidence-bound menu record
     -> Deals -> current, expiry-bounded offer -> business profile
     -> Neighborhoods -> local context -> nearby candidate, not eligibility claim
     -> Learn -> reviewed guidance or explicitly labeled draft
```

## 9. Three original design directions

### Direction A: Civic Market Journal

- **Organizing idea:** the marketplace reads like a confident local publication,
  with one strong search decision and successive open chapters.
- **Homepage:** sponsored rail, large plain-language headline, text shortcuts,
  equal delivery/dispensary chapters, image-led products, typographic
  neighborhoods, trust notes, editorial guides, open FAQ.
- **Banner:** wide reserved editorial composition with a dedicated mobile source,
  static by default and fully disclosed.
- **Delivery/dispensary:** separate chapters and routes using image + type + a few
  evidence-backed signals, never boxed dashboards.
- **Deals:** open horizontal editorial strip with expiry/source language.
- **Mobile:** single-column reading rhythm; direct delivery/search actions; native
  filter disclosure.
- **Advantage:** best match for premium, open, local, trustworthy and no-card-wall.
- **Weakness:** less dense than a power-shopping interface.
- **Complexity:** medium.
- **Extensibility:** high; each chapter is a declared page-intelligence section.

### Direction B: District Discovery Atlas

- **Organizing idea:** location and neighborhood are the primary navigation model.
- **Homepage:** banner, location search, map/list switch, neighborhood narratives,
  delivery coverage prompts, retailers and products as map-linked layers.
- **Banner:** local guide or service-area creative keyed to the selected district.
- **Delivery/dispensary:** geographically paired, with explicit map semantics.
- **Deals:** location-filtered markers and a compact list.
- **Mobile:** map/list toggle and bottom-sheet filters.
- **Advantage:** strongest neighborhood and proximity model.
- **Weakness:** map complexity can delay the simple first decision and increase JS.
- **Complexity:** high.
- **Extensibility:** high when reliable service-area geometry exists.

### Direction C: Signal-First Local Market

- **Organizing idea:** a compact shopping index that prioritizes status, fulfillment
  and next action.
- **Homepage:** banner, instant filters, dense result stream, deals, delivery and
  storefront modes, then education.
- **Banner:** short, utility-like placement with campaign controls.
- **Delivery/dispensary:** high-signal list rows with fast filtering.
- **Deals:** strongest emphasis and fastest scan.
- **Mobile:** sticky filter affordance and compact rows.
- **Advantage:** fastest for repeat customers with known intent.
- **Weakness:** density risks recreating a dashboard/card-wall feeling.
- **Complexity:** medium.
- **Extensibility:** medium-high.

## 10. Concept scores

| Criterion | Civic Market Journal | District Discovery Atlas | Signal-First Local Market |
|---|---:|---:|---:|
| Customer clarity | 96 | 90 | 94 |
| Delivery clarity | 95 | 96 | 93 |
| Visual quality | 97 | 92 | 84 |
| Originality | 95 | 94 | 87 |
| Trust | 96 | 92 | 90 |
| No-divider compliance | 100 | 94 | 90 |
| No-card-wall compliance | 98 | 91 | 82 |
| Accessibility | 95 | 86 | 93 |
| Performance | 95 | 78 | 94 |
| Implementation feasibility | 94 | 78 | 92 |
| **Weighted result** | **96** | **89** | **90** |

## 11. Selected direction

**Civic Market Journal** is selected without mixing in the map-led or dense-index
information architecture. It best satisfies the owner’s white-canvas, premium,
open, local, no-divider and no-card-wall laws while still preserving fast search
and first-class delivery.

Ten headline directions considered:

1. Find the D.C. option that fits your day.
2. D.C. cannabis, easier to understand.
3. A clearer way to find cannabis in D.C.
4. Delivery, dispensaries and deals across D.C.
5. Start with where you are. See what is supported.
6. Explore D.C. cannabis without the guesswork.
7. Your local guide to D.C. dispensaries and delivery.
8. Find a menu, a deal or a delivery option nearby.
9. D.C. discovery with the important details in view.
10. Know the source before you choose.

Selected headline: **A clearer way to find cannabis in D.C.** It is direct,
customer-readable and makes no availability, legality, ranking or outcome claim.

## 12. Homepage and sponsored-banner architecture

Final order:

1. Customer navigation
2. Primary sponsored/house banner
3. Discovery headline and unified search
4. Open quick paths
5. Current deal previews
6. Delivery in Washington, D.C.
7. Dispensaries in Washington, D.C.
8. Product-format discovery
9. Neighborhood discovery
10. Trust and transparency
11. Learn and local guides
12. Customer questions
13. Restrained business invitation
14. Footer

Banner behavior:

- The slot is rendered immediately below customer navigation on the homepage.
- Desktop and mobile media URLs are separate fields and selected with `<picture>`.
- Explicit intrinsic width and height reserve the slot before image load.
- Only approved, in-window campaigns with both media variants and an allowlisted
  internal destination are eligible.
- Paid candidates must also carry an `ACTIVE` result from the repository's
  canonical persisted sponsorship-entitlement resolver. Editable campaign fields
  cannot create paid placement authority.
- Expired, unapproved, malformed, or missing-media campaigns are rejected.
- A configured ORDERWEEDDC house campaign may be used as fallback; otherwise the
  slot collapses without leaving a frame.
- Initial implementation is static: no autoplay, rotation, sound, flashing,
  carousel controls, or motion burden.
- The configured fallback is labeled “House campaign” and “No paid campaign is
  live in this review build.”
- Banner impressions and clicks emit a same-origin `orderweeddc:banner-event`
  browser event with campaign ID, declared event name and funding kind. No
  analytics sink or commercial outcome is inferred from those events.

## 13. Banner content and policy model

Each campaign record declares: campaign ID, sponsor, disclosure, headline,
supporting text, CTA, exact internal destination, desktop media, mobile media,
alt text, start/end, audience, D.C. relevance, approval state, rights/provenance,
policy result, impression event name, click event name, frequency cap, funding
kind, and fallback behavior.

Policy is fail-closed. A campaign cannot render when it is expired, unapproved,
missing rights/provenance, missing media, missing alt text, or points outside the
allowlisted customer route set. Payment never changes verification status or
organic listing order. Paid records additionally require a canonical active,
chain-linked entitlement result whose disclosure matches the campaign.

## 14. Marketplace domain architecture

- **Delivery:** `Retailer.type=delivery` is a customer-visible participant type.
  The current schema has no sourced service-area, fee, minimum, schedule, or ETA
  fields, so the interface shows “confirm service area” and “details unavailable”
  rather than invented values. Delivery records do not expose street addresses.
- **Directory bounds:** delivery and dispensary queries share the repository's
  public-record predicate, truth-first ordering, twenty-result server-side page,
  total count and validated offset. Pagination retains only the normalized query.
- **Dispensaries:** `Retailer.type=storefront` uses neighborhood/city, hours only
  when present, menu/deal availability, evidence state, and profile action.
- **Deals:** current predicate requires active, unexpired records; demonstration
  offers remain visibly not redeemable.
- **Products:** category entry points are editorial; availability belongs only to
  a menu entry with its own data state.
- **Neighborhoods:** fixed D.C. guide pages describe candidate proximity windows,
  never delivery compatibility.
- **Trust:** plain labels translate repository evidence state; internal confidence
  scores, graph names and infrastructure remain invisible.
- **Learn/FAQ:** editorial surfaces stay open and unlined. Demonstration drafts are
  labeled and are not represented as current legal or medical advice.

## 15. Page intelligence, media slots, and Hermes boundary

The implementation module is required to declare for every core route: audience,
intent, business purpose, conversions, sections, content/media/banner slots,
trust/source/SEO/legal constraints, permitted/prohibited transformations,
experiment eligibility, and rollback strategy.

Media slots cover banner desktop/mobile, result imagery, product categories,
neighborhoods, guides, trust, and social/OG use. Each declares purpose, subject,
ratios, focal point, text-safe region, minimum dimensions, maximum bytes, formats,
compression target, alt text, rights/provenance, generated-image disclosure,
prohibited content, approval and replacement policy.

Hermes remains proposal-only. Allowed proposal verbs are `INSERT_SECTION`,
`REMOVE_SECTION`, `MOVE_SECTION`, `REPLACE_SECTION`, `MERGE_SECTIONS`,
`SPLIT_SECTION`, `REWRITE_COPY`, `REPLACE_MEDIA`, `CHANGE_CTA`, `CREATE_VARIANT`,
`CREATE_BANNER_VARIANT`, and `REPLACE_BANNER_MEDIA`. It cannot publish, deploy,
change truth labels, change organic order, authorize spend, access customer
identity, rewrite production JSX, or bypass review gates.

## 16. Implementation-time verification ledger

The results below are historical implementation-time observations and are not
the final candidate identity proof. The final owner-review task retains its
exact-SHA evidence outside the Git worktree in the sibling folder named
`ORDERWEEDDC_PR21_FINAL_OWNER_REVIEW_PACKET_<short-sha>/`. That packet contains
`capture-metadata.json`, `mobile-performance-final.json`,
`verify-focused-receipt.json`, `verify-full-receipt.json`,
`durability-build-receipt.json`, `durability-verify-receipt.json`,
`durability-restore-receipt.json`, and `SHA256SUMS.txt`. Each final receipt must
name the same full commit and tree as the packet README before owner review.

### Runtime and safety

- Node binary: `/Users/Apple/.nvm/versions/node/v20.20.2/bin/node`
- `process.version`: `v20.20.2`
- `process.execPath`: `/Users/Apple/.nvm/versions/node/v20.20.2/bin/node`
- Review data: disposable SQLite database under the macOS temporary directory;
  production data was not read or mutated.
- Production/cPanel/deployment actions: none.
- Protected glossy OW assets and favicons: byte-for-byte unchanged from canonical
  parent; all thirteen SHA-256 values were rechecked.

### Automated verification

| Gate | Result | Evidence |
|---|---|---|
| Customer-focused source/integration tests | PASS | 48 passed, 0 failed; includes 11 sovereign UI policy laws |
| Customer browser automation | PASS | 4 passed, 0 failed; routes, emitted banner events, truth states, mobile navigation, visual constitution, age-gate focus, Axe and throttled performance |
| TypeScript | PASS | `tsc --noEmit -p apps/web/tsconfig.json` |
| Changed-file ESLint | PASS | 0 errors and 0 warnings across changed code and tests |
| Production build | PASS | Next.js 16.3.0-canary.6 compiled, type-checked and emitted all customer routes |
| Browser route/visual matrix | PASS | Executable test: `apps/web/tests/customer-sovereign-ui.browser.mjs`; desktop 1440px and mobile 390px; homepage, delivery, dispensaries and search; no console warning/error, no unexpected request failure, no horizontal overflow |
| WCAG A/AA audit | PASS | Axe serious/critical violations: 0 across four routes at 1440px and 390px; age-gate focus and wrap behavior passed |
| Slower-mobile performance | PASS | 150ms latency, 1.6 Mbps down, 4x CPU: LCP 3520ms, CLS 0.00199, third-party scripts 0 |
| Clean deterministic Linux full court | PASS | 693 passed, 0 failed: 663 web, 9 ad-creative, 4 retired-AI-boundary and 17 deployment-court tests; immutable Node image, disposable database, container-only port, stale-build proof, exact server identity and cleanup all passed |
| Host-only macOS full-web diagnostic | NOT AUTHORITATIVE | 663 tests discovered: 582 passed, 81 failed under the host Prisma engine and suite-global build/server contention; the clean Linux court above is the repository's release-verification boundary |
| Dependency audit | KNOWN BASELINE | 1 high-severity transitive development dependency finding in `brace-expansion`; no forced dependency rewrite was made in this UI branch |

The production build emits one pre-existing Turbopack NFT tracing warning from
`evidence-spill.mjs` through the retailer handoff route. Compilation and route
generation complete successfully.

Reproduction commands:

- Focused policy/integration tests: `node --test apps/web/tests/customer-sovereign-ui.test.mjs apps/web/tests/tenant-rewrite.test.mjs apps/web/tests/security-boundary.test.mjs apps/web/tests/sitemind.test.mjs apps/web/tests/marketplace-ui.test.mjs`
- Browser automation against an isolated production server: `CUSTOMER_REVIEW_BASE_URL=http://orderweeddc.localhost:<port> CUSTOMER_REVIEW_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:customer-browser -w apps/web`
- Production build: `npm run build -w apps/web`
- Clean deterministic Linux gate after the final commit: `./cana verify full`

### Implemented customer routes

- `/`: new Civic Market Journal homepage and primary house/sponsored rail.
- `/delivery`: dedicated delivery-only discovery with service-area truth labels,
  filters, empty state and no delivery-address exposure.
- `/dispensaries`: dedicated storefront discovery with source/freshness labels,
  filters and empty state.
- `/search`: grouped marketplace search across businesses, products, current
  deals and configured neighborhoods; explicitly noindexed.
- Existing `/products`, `/deals`, `/neighborhoods`, `/education`, retailer,
  customer login, business and admin route ownership remains intact.
- Delivery alias `dmvweeddelivery.com` now resolves to `/delivery` instead of a
  homepage query-string filter.

### Screenshot package

All files are captured from the production build with the disposable
demonstration database. Demonstration records are visibly labeled.

- `screenshots/desktop-homepage.png`
- `screenshots/mobile-homepage.png`
- `screenshots/desktop-delivery.png`
- `screenshots/mobile-delivery.png`
- `screenshots/desktop-dispensaries.png`
- `screenshots/mobile-dispensaries.png`
- `screenshots/banner-desktop.png`
- `screenshots/banner-mobile.png`
- `screenshots/search-filter.png`

### Known limitations

- The retained review dataset is synthetic. It proves layout and truth-state
  behavior, not real D.C. inventory, service coverage, business status, prices,
  demand or outcomes.
- Address-level delivery eligibility, fees, minimums, schedules and arrival times
  are not represented by the current schema; the UI intentionally asks customers
  to confirm them with the business.
- The banner ships with a static ORDERWEEDDC house fallback. No paid campaign,
  persisted analytics sink, rotation, personalization or frequency-cap receipt
  is active; local impression/click events are observable without being called
  revenue or performance.
- Unified search is server-rendered and grouped, not a live autocomplete or map.
- Saved businesses remain local-browser state and have no dedicated `/saved`
  account surface.
- Existing deeper product, deal, neighborhood, education and retailer routes were
  preserved; this phase redesigns their homepage entry points rather than
  replacing their domain logic.
- The direct host-only macOS run still encounters Prisma engine drift and
  suite-global build/server contention. The immutable Linux court passes; the
  host diagnostic and transitive audit finding remain reported rather than hidden.

### Exact owner review checklist

1. Confirm the glossy OW wordmark remains the approved asset at every breakpoint.
2. Confirm the primary banner is immediately beneath navigation and feels
   premium, original and appropriately disclosed.
3. Confirm the separate mobile banner crop preserves readable copy and focal area.
4. Confirm the white/neutral canvas contains no green section bands, gradients,
   glows, decorative divider lines or card-wall rhythm.
5. Confirm a new customer can find Delivery and Dispensaries immediately and sees
   them as equal marketplace participants.
6. Confirm delivery records never imply address eligibility, fee, minimum, ETA or
   a private operational address.
7. Confirm demonstration businesses, products, offers and editorial records cannot
   be mistaken for current real-world claims.
8. Confirm search, filters, empty states, mobile navigation and Customer Sign In
   labels are understandable without internal terminology.
9. Confirm deals, products, neighborhoods, trust, learning and FAQ sections create
   one open editorial journey on desktop and mobile.
10. Confirm SiteMind, Hermes, evidence-graph and confidence-score language is absent
    from customer-visible copy.
11. Review all nine committed screenshots at full size.
12. Approve the review PR for a later merge, or request exact changes; do not treat
    this unmerged branch as deployed production.
