import Link from 'next/link';
import RetailerMapLoader from '@/components/retailer-map-loader';
import type { ProjectedMarker } from '@/components/retailer-map-maplibre';

export type EvidenceField = {
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

export type CustomerWorld = {
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

function value(field: EvidenceField, fallback: string) {
  return field.state === 'KNOWN' && (typeof field.value === 'string' || typeof field.value === 'number')
    ? String(field.value)
    : fallback;
}

function UnknownFacts({ result }: { result: CustomerResult }) {
  const facts: ReadonlyArray<readonly [string, EvidenceField]> = [
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
        <div key={label} className="rounded-lg border border-brand-border bg-brand-background p-2.5">
          <dt className="font-semibold text-brand-muted">{label}</dt>
          <dd className="mt-1 font-bold text-brand-text">{field.state}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultList({ world }: { world: CustomerWorld }) {
  return (
    <div className="grid gap-4" data-customer-result-count={world.results.length}>
      {world.results.map((result) => (
        <article key={result.id} id={`merchant-${result.id}`} data-customer-merchant-id={result.id} className="rounded-2xl border border-brand-border bg-brand-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-primary-text">{value(result.verification_state, 'Verification UNKNOWN')}</p>
              <h2 className="mt-1 font-display text-2xl font-bold text-brand-text">{value(result.name, 'Merchant name UNKNOWN')}</h2>
              <p className="mt-2 text-sm text-brand-muted">{value(result.business_type, 'Business type UNKNOWN')}</p>
            </div>
            <Link href={result.profile_href} className="inline-flex min-h-11 items-center rounded-lg border border-brand-border px-4 text-sm font-bold text-brand-primary-text">View verified profile</Link>
          </div>
          <p className="mt-4 text-sm text-brand-text">
            {value(result.location.address, 'Address UNKNOWN')}, {' '}
            {value(result.location.city, 'City UNKNOWN')}, {' '}
            {value(result.location.region, 'Region UNKNOWN')} {' '}
            {value(result.location.postal_code, '')}
          </p>
          <p className="mt-2 text-xs text-brand-muted">Source: {result.provenance.source ?? 'UNKNOWN'}</p>
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
  const projectedMarkers: ProjectedMarker[] = world.map.markers.map((marker) => ({
    canaLocationId: marker.id,
    retailerId: marker.id,
    name: marker.name,
    type: 'Verified merchant record',
    lat: marker.latitude,
    lng: marker.longitude,
    h3R9: null,
    coordinateSource: 'canonical_reality_claim',
    coordinateVerification: 'VERIFIED',
    publiclyVerified: true,
    dataStatus: marker.verification_state,
    claims: {},
    profileHref: marker.profile_href,
  }));
  return (
    <div>
      <div className="h-[420px] overflow-hidden rounded-2xl border border-brand-border bg-brand-surface p-1 sm:h-[540px]" data-map-merchant-ids={world.map.markers.map((marker) => marker.id).join(',')}>
        <RetailerMapLoader retailers={[]} engine="maplibre" projectedMarkers={projectedMarkers} />
      </div>
      <p className="mt-3 text-xs text-brand-muted">
        {world.map.markers.length} mapped, {world.map.unmappable_count} coordinate UNKNOWN. List and map use the same discovery result identities.
      </p>
    </div>
  );
}

export default function CustomerWorldResults({ world, mapView }: { world: CustomerWorld; mapView: boolean }) {
  if (world.state === 'CAPABILITY_GAP') {
    return (
      <div role="status" className="mt-8 rounded-2xl border border-amber-500/40 bg-brand-surface p-6">
        <h2 className="font-display text-2xl font-bold text-brand-text">Capability gap preserved</h2>
        <p className="mt-3 text-sm text-brand-muted">
          Unsupported: {world.unsupported_dimensions.join(', ')}. No merchant is presented as delivery-capable and no service area, fee, ETA, or inventory is inferred.
        </p>
      </div>
    );
  }
  if (world.state === 'INPUT_REQUIRED' || world.state === 'EMPTY') {
    return (
      <div role="status" className="mt-8 rounded-2xl border border-brand-border bg-brand-surface p-8">
        <h2 className="font-display text-2xl font-bold text-brand-text">{world.state.replace('_', ' ')}</h2>
        <p className="mt-3 max-w-2xl text-sm text-brand-muted">{world.state_explanation}</p>
      </div>
    );
  }
  return <div className="mt-8">{mapView ? <ResultMap world={world} /> : <ResultList world={world} />}</div>;
}
