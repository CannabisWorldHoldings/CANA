"use client";

import dynamic from 'next/dynamic';
import type { ProjectedMarker } from '@/components/retailer-map-maplibre';

const loading = () => (
  <div className="w-full h-full bg-slate-100 animate-pulse flex items-center justify-center text-xs text-slate-400 font-sans">
    Initializing Interactive Map...
  </div>
);

// Legacy engine — remains the default until the MapLibre parity gate
// (docs/geo/SLICE2_MAP_PARITY.md G1–G10) is green in production.
const DynamicRetailerMap = dynamic(() => import('@/components/retailer-map'), {
  ssr: false,
  loading,
});

// Slice 2 engine — evidence-gated MapLibre surface. Selected only when the
// server passes engine="maplibre" (CANA_MAP_ENGINE env). Rollback is
// unsetting one env var; the Leaflet path is untouched.
const DynamicRetailerMapMapLibre = dynamic(
  () => import('@/components/retailer-map-maplibre'),
  { ssr: false, loading },
);

type RetailerPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
};

type Props = {
  retailers: RetailerPin[];
  engine?: 'leaflet' | 'maplibre';
  /** Evidence-gated projection; required when engine="maplibre". */
  projectedMarkers?: ProjectedMarker[];
  onMarkerSelect?: (retailerId: string) => void;
  selectedRetailerId?: string | null;
};

export default function RetailerMapLoader({
  retailers,
  engine = 'leaflet',
  projectedMarkers,
  onMarkerSelect,
  selectedRetailerId,
}: Props) {
  if (engine === 'maplibre' && projectedMarkers) {
    return (
      <DynamicRetailerMapMapLibre
        markers={projectedMarkers}
        onMarkerSelect={onMarkerSelect}
        selectedRetailerId={selectedRetailerId}
      />
    );
  }
  return <DynamicRetailerMap retailers={retailers} />;
}
