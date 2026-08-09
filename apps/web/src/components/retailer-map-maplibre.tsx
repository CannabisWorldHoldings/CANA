"use client";

/**
 * MapLibre customer map surface (Slice 2).
 *
 * Rendering layer ONLY. This component receives a finished
 * PublicMapProjection and draws it. It contains no Prisma, no SQL, no policy
 * and no evidence decisions — if a fact is not in the projection, the UI
 * shows an explicit unknown state rather than inventing one.
 *
 * Parity contract: docs/geo/SLICE2_MAP_PARITY.md (G1–G10). The legacy
 * Leaflet implementation remains the default engine until that gate is green.
 */
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyle } from '@/lib/geo/tile-sources.mjs';

export type ProjectedClaim = {
  type: string;
  value: string;
  verification: 'VERIFIED' | 'SUPPORTED';
  observedAt: string | null;
  source: string;
  confidence: number | null;
};

export type ProjectedMarker = {
  canaLocationId: string | null;
  retailerId: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  h3R9: string | null;
  coordinateSource: 'geo_entity' | 'legacy_retailer';
  coordinateVerification: string;
  publiclyVerified: boolean;
  dataStatus: string;
  claims: Record<string, ProjectedClaim>;
};

type Props = {
  markers: ProjectedMarker[];
  onMarkerSelect?: (retailerId: string) => void;
  selectedRetailerId?: string | null;
};

const DC_CENTER: [number, number] = [-77.0369, 38.9072]; // lng, lat
const DC_ZOOM = 12;

/** Popup body built from evidence-gated data only. */
function popupHtml(marker: ProjectedMarker): string {
  const status = marker.claims.operating_status;
  const hours = marker.claims.hours;
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );

  // Explicit unknown states — the projection's absent keys become visible
  // honesty, never fabricated defaults.
  const statusLine = status
    ? `<span class="cana-pop-status" data-verification="${status.verification}">${escape(status.value)}</span>`
    : `<span class="cana-pop-status cana-pop-unknown">Status not verified</span>`;
  const hoursLine = hours
    ? `<span class="cana-pop-hours">${escape(hours.value)}</span>`
    : '';
  const badge = marker.publiclyVerified
    ? `<span class="cana-pop-badge">Verified listing</span>`
    : `<span class="cana-pop-badge cana-pop-badge-pending">Awaiting verification</span>`;

  return `
    <div class="cana-popup" data-retailer-id="${escape(marker.retailerId)}">
      <strong class="cana-pop-name">${escape(marker.name)}</strong>
      <span class="cana-pop-type">${escape(marker.type)}</span>
      ${badge}
      ${statusLine}
      ${hoursLine}
      <a class="cana-pop-link" href="/retailer/${escape(marker.retailerId)}">View Directory</a>
    </div>`;
}

export default function RetailerMapMapLibre({ markers, onMarkerSelect, selectedRetailerId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjectsRef = useRef<maplibregl.Marker[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [initFailed, setInitFailed] = useState(false);

  // Map lifecycle.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle(),
        center: DC_CENTER,
        zoom: DC_ZOOM,
        // Parity P7: never hijack page scroll.
        scrollZoom: false,
        attributionControl: { compact: true },
      });
    } catch {
      // Deferred so the state update happens outside the synchronous effect
      // body (avoids cascading-render lint rule while keeping the visible
      // error state).
      queueMicrotask(() => {
        setInitFailed(true);
        setMapError('The map could not be initialized.');
      });
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => {
      // Tile/network failures degrade to an explicit error state, never a
      // silent blank rectangle.
      setMapError('Map data is temporarily unavailable.');
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Marker sync + fit-bounds (parity P4/P5/P6).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of markerObjectsRef.current) m.remove();
    markerObjectsRef.current = [];

    if (markers.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    for (const marker of markers) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `cana-marker${marker.publiclyVerified ? ' cana-marker-verified' : ''}`;
      el.textContent = marker.name.substring(0, 1).toUpperCase();
      // Parity G9: markers are real buttons — focusable and screen-reader named.
      el.setAttribute('aria-label', `${marker.name} (${marker.type})`);

      const popup = new maplibregl.Popup({ offset: 18, closeButton: false }).setHTML(
        popupHtml(marker),
      );
      const markerObject = new maplibregl.Marker({ element: el })
        .setLngLat([marker.lng, marker.lat])
        .setPopup(popup)
        .addTo(map);
      el.addEventListener('click', () => onMarkerSelect?.(marker.retailerId));

      markerObjectsRef.current.push(markerObject);
      bounds.extend([marker.lng, marker.lat]);
    }

    map.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 0 });
  }, [markers, onMarkerSelect]);

  // List -> map synchronization: fly to an externally selected retailer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedRetailerId) return;
    const target = markers.find((m) => m.retailerId === selectedRetailerId);
    if (target) map.flyTo({ center: [target.lng, target.lat], zoom: 15 });
  }, [selectedRetailerId, markers]);

  if (initFailed) {
    return (
      <div
        role="alert"
        className="flex h-full w-full items-center justify-center rounded-lg bg-slate-100 p-4 text-center text-xs text-slate-500"
      >
        {mapError} The directory list below remains fully usable.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-lg" aria-label="Map of retailers" />
      {mapError ? (
        <div
          role="alert"
          className="absolute inset-x-3 top-3 rounded-lg bg-white/95 p-3 text-center text-xs text-slate-600 shadow-sm"
        >
          {mapError} The directory list below remains fully usable.
        </div>
      ) : null}
    </div>
  );
}
