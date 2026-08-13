import Link from 'next/link';
import RetailerMapLoader from '@/components/retailer-map-loader';

type EvidenceField = {
  state: 'KNOWN' | 'UNKNOWN' | 'CAPABILITY_GAP';
  value: unknown;
  reason?: string;
  dimension?: string;
};

type CustomerResult = {
  id: string;
  name: EvidenceField;
  business_type: EvidenceField;
  regulatory_state: EvidenceField;
  verification_state: EvidenceField;
  location: {
    address: EvidenceField;
    city: EvidenceField;
    region: EvidenceField;
    postal_code: EvidenceField;
    coordinates: EvidenceField;
  };
  delivery_eligibility: EvidenceField;
  price: EvidenceField;
  open_now: EvidenceField;
  inventory: EvidenceField;
  eta: EvidenceField;
  service_area: EvidenceField;
  popularity: EvidenceField;
  freshness: EvidenceField;
  provenance: { source?: string; source_url?: string };
  profile_href: string;
};

type CustomerWorld = {
  state: 'INPUT_REQUIRED' | 'CAPABILITY_GAP' | 'RESULTS' | 'EMPTY';
  state_explanation: string;
  request: {
    journey: 'HOME' | 'SEARCH' | 'DELIVERY' | 'DISPENSARIES';
    market_id: string;
    customer_query: string;
    requested_view: string;
  };
  results: CustomerResult[];
  map: {
    state: 'KNOWN' | 'UNKNOWN';
    markers: Array<{
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      profile_href: string;
      verification_state: string;
    }>;
    unmappable_count: number;
    explanation: string;
  };
  unsupported_dimensions: string[];
  unknown_dimensions: string[];
  generated_at: string;
};

const JOURNEY_COPY = {
  HOME: {
    eyebrow: 'Customer World',
    title: 'One verified path from intent to discovery.',
    description: 'Search admitted market Reality, choose a distinct customer journey, and see unknowns before making a decision.',
    action: '/search',
    placeholder: 'City or neighborhood',
  },
  SEARCH: {
    eyebrow: 'Marketplace search',
    title: 'Search verified merchant records without blending truth paths.',
    description: 'ASK compiles your words, applies the selected market contract, and returns only current canonical Reality projections.',
    action: '/search',
    placeholder: 'City, neighborhood, or supported intent',
  },
  DELIVERY: {
    eyebrow: 'Delivery discovery',
    title: 'Delivery is a distinct journey, with eligibility kept honest.',
    description: 'A verified merchant record does not prove delivery authority, service area, fee, minimum, inventory, or arrival time.',
    action: '/delivery',
    placeholder: 'City or neighborhood for delivery',
  },
  DISPENSARIES: {
    eyebrow: 'Dispensary discovery',
    title: 'Find regulator-backed dispensary records by place.',
    description: 'Results carry their admitted market source and current verification state. Hours, inventory, and popularity remain unknown unless proven.',
    action: '/dispensaries',
    placeholder: 'City or neighborhood for dispensaries',
  },
} as const;

function value(field: EvidenceField, fallback: string) {
  return field?.state === 'KNOWN' && (typeof field.value === 'string' || typeof field.value === 'number')
    ? String(field.value)
    : fallback;
}

function viewHref(world: CustomerWorld, view: 'list' | 'map') {
  const copy = JOURNEY_COPY[world.request.journey];
  const params = new URLSearchParams({ market: world.request.market_id, view });
  if (world.request.customer_query) params.set('query', world.request.customer_query);
  return `${copy.action}?${params}`;
}

function UnknownFacts({ result }: { result: CustomerResult }) {
  const facts = [
    ['Hours', result.open_now],
    ['Price', result.price],
    ['Inventory', result.inventory],
    ['ETA', result.eta],
    ['Service area', result.service_area],
    ['Popularity', result.popularity],
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
      {facts.map(([label, field]) => (
        <div key={label as string} className="rounded-lg border border-brand-border bg-brand-background p-2.5">
          <dt className="font-semibold text-brand-muted">{label as string}</dt>
          <dd className="mt-1 font-bold text-brand-text">{(field as EvidenceField).state}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultList({ world }: { world: CustomerWorld }) {
  return (
    <div className="grid gap-4" data-customer-result-count={world.results.length}>
      {world.results.map((result) => (
        <article
          key={result.id}
          id={`merchant-${result.id}`}
          data-customer-merchant-id={result.id}
          className="rounded-2xl border border-brand-border bg-brand-surface p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-primary-text">
                {value(result.verification_state, 'Verification UNKNOWN')}
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold text-brand-text">
                {value(result.name, 'Merchant name UNKNOWN')}
              </h2>
              <p className="mt-2 text-sm text-brand-muted">
                {value(result.business_type, 'Business type UNKNOWN')}
              </p>
            </div>
            <Link
              href={result.profile_href}
              className="inline-flex min-h-11 items-center rounded-lg border border-brand-border px-4 text-sm font-bold text-brand-primary-text"
            >
              View verified profile
            </Link>
          </div>
          <p className="mt-4 text-sm text-brand-text">
            {value(result.location.address, 'Address UNKNOWN')}, {' '}
            {value(result.location.city, 'City UNKNOWN')}, {' '}
            {value(result.location.region, 'Region UNKNOWN')} {' '}
            {value(result.location.postal_code, '')}
          </p>
          <p className="mt-2 text-xs text-brand-muted">
            Source: {result.provenance.source ?? 'UNKNOWN'}
          </p>
          <UnknownFacts result={result} />
        </article>
      ))}
    </div>
  );
}

function ResultMap({ world }: { world: CustomerWorld }) {
  if (world.map.markers.length === 0) {
    return (
      <div role="status" className="rounded-2xl border border-brand-border bg-brand-surface p-8">
        <h2 className="font-display text-2xl font-bold text-brand-text">Map location UNKNOWN</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-muted">{world.map.explanation}</p>
        <p className="mt-2 text-xs font-semibold text-brand-muted">
          {world.map.unmappable_count} list result{world.map.unmappable_count === 1 ? '' : 's'} omitted from the map because verified coordinates are unavailable.
        </p>
      </div>
    );
  }
  const projectedMarkers = world.map.markers.map((marker) => ({
    canaLocationId: marker.id,
    retailerId: marker.id,
    name: marker.name,
    type: 'Verified merchant record',
    lat: marker.latitude,
    lng: marker.longitude,
    h3R9: null,
    coordinateSource: 'canonical_reality_claim' as const,
    coordinateVerification: 'VERIFIED',
    publiclyVerified: true,
    dataStatus: marker.verification_state,
    claims: {},
    profileHref: marker.profile_href,
  }));
  return (
    <div>
      <div
        className="h-[420px] overflow-hidden rounded-2xl border border-brand-border bg-brand-surface p-1 sm:h-[540px]"
        data-map-merchant-ids={world.map.markers.map((marker) => marker.id).join(',')}
      >
        <RetailerMapLoader
          retailers={[]}
          engine="maplibre"
          projectedMarkers={projectedMarkers}
        />
      </div>
      <p className="mt-3 text-xs text-brand-muted">
        {world.map.markers.length} mapped, {world.map.unmappable_count} coordinate UNKNOWN. List and map use the same discovery result identities.
      </p>
    </div>
  );
}

export default function CustomerWorldPage({ world }: { world: CustomerWorld }) {
  const copy = JOURNEY_COPY[world.request.journey];
  const mapView = world.request.requested_view === 'map';
  return (
    <div className="flex-grow">
      <section className="border-b border-brand-border px-4 py-12 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-screen-2xl">
          <p className="kicker">{copy.eyebrow}</p>
          <h1 className="mt-3 max-w-4xl font-display text-4xl font-bold tracking-tight text-brand-text sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-brand-muted">{copy.description}</p>
          <form action={copy.action} method="GET" className="mt-7 flex max-w-4xl flex-col gap-3 sm:flex-row">
            <label htmlFor="customer-world-query" className="sr-only">Customer discovery query</label>
            <input
              id="customer-world-query"
              name="query"
              type="search"
              maxLength={160}
              defaultValue={world.request.customer_query}
              placeholder={copy.placeholder}
              className="min-h-12 flex-grow rounded-xl border border-brand-border bg-brand-background px-4 text-base text-brand-text"
            />
            <label htmlFor="customer-world-market" className="sr-only">Market</label>
            <select
              id="customer-world-market"
              name="market"
              defaultValue={world.request.market_id}
              className="min-h-12 rounded-xl border border-brand-border bg-brand-background px-4 text-sm font-semibold text-brand-text"
            >
              <option value="US-DC">Washington, D.C.</option>
              <option value="US-MD">Maryland</option>
              <option value="US-VA">Virginia</option>
            </select>
            <input type="hidden" name="view" value={world.request.requested_view} />
            <button type="submit" className="min-h-12 rounded-xl bg-brand-primary-fill-strong px-6 text-sm font-bold text-white">
              Discover
            </button>
          </form>
          {world.request.journey === 'HOME' ? (
            <nav aria-label="Customer journeys" className="mt-8 grid gap-3 sm:grid-cols-3">
              <Link href="/search" className="rounded-xl border border-brand-border bg-brand-surface p-4 font-bold text-brand-text">Search the market</Link>
              <Link href="/delivery" className="rounded-xl border border-brand-border bg-brand-surface p-4 font-bold text-brand-text">Delivery discovery</Link>
              <Link href="/dispensaries" className="rounded-xl border border-brand-border bg-brand-surface p-4 font-bold text-brand-text">Dispensary discovery</Link>
            </nav>
          ) : null}
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6 lg:px-10" aria-live="polite">
        <div className="mx-auto max-w-screen-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-brand-text">State: {world.state}</p>
              <p className="mt-1 max-w-3xl text-sm text-brand-muted">{world.state_explanation}</p>
            </div>
            <nav aria-label="Discovery view" className="flex rounded-xl border border-brand-border bg-brand-surface p-1">
              <Link aria-current={!mapView ? 'page' : undefined} href={viewHref(world, 'list')} className="rounded-lg px-4 py-2 text-sm font-bold text-brand-text">List</Link>
              <Link aria-current={mapView ? 'page' : undefined} href={viewHref(world, 'map')} className="rounded-lg px-4 py-2 text-sm font-bold text-brand-text">Map</Link>
            </nav>
          </div>

          {world.state === 'CAPABILITY_GAP' ? (
            <div role="status" className="mt-8 rounded-2xl border border-amber-500/40 bg-brand-surface p-6">
              <h2 className="font-display text-2xl font-bold text-brand-text">Capability gap preserved</h2>
              <p className="mt-3 text-sm text-brand-muted">
                Unsupported: {world.unsupported_dimensions.join(', ')}. No merchant is presented as delivery-capable and no service area, fee, ETA, or inventory is inferred.
              </p>
            </div>
          ) : world.state === 'INPUT_REQUIRED' || world.state === 'EMPTY' ? (
            <div role="status" className="mt-8 rounded-2xl border border-brand-border bg-brand-surface p-8">
              <h2 className="font-display text-2xl font-bold text-brand-text">{world.state.replace('_', ' ')}</h2>
              <p className="mt-3 max-w-2xl text-sm text-brand-muted">{world.state_explanation}</p>
            </div>
          ) : (
            <div className="mt-8">{mapView ? <ResultMap world={world} /> : <ResultList world={world} />}</div>
          )}
        </div>
      </section>
    </div>
  );
}
