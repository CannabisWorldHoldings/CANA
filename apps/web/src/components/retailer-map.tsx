"use client";

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import Link from 'next/link';
import L from 'leaflet';

type RetailerPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
};

type RetailerMapProps = {
  retailers: RetailerPin[];
};

function MapBoundsUpdater({ retailers }: { retailers: RetailerPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (retailers.length > 0) {
      // Small timeout to ensure map is fully rendered before fitting bounds
      setTimeout(() => {
        const bounds = L.latLngBounds(retailers.map(r => [r.lat, r.lng]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      }, 100);
    }
  }, [map, retailers]);
  return null;
}

export default function RetailerMap({ retailers }: RetailerMapProps) {
  // This component is only ever loaded with `ssr: false` (see
  // retailer-map-loader), so no client-mount guard is needed.
  const defaultCenter: [number, number] = [38.9072, -77.0369]; // Washington D.C. center

  const createIcon = (name: string, isSponsored: boolean = false) => L.divIcon({
    className: 'bg-transparent border-0',
    html: `<div class="w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white ${isSponsored ? 'bg-brand-primary text-white scale-110' : 'bg-emerald-950 text-white'} text-xs font-black transition-transform hover:scale-125">${name.substring(0, 1).toUpperCase()}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });

  return (
    <MapContainer 
      center={defaultCenter} 
      zoom={12} 
      scrollWheelZoom={false} 
      className="w-full h-full z-0 rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      <MapBoundsUpdater retailers={retailers} />
      {retailers.map((r) => (
        <Marker key={r.id} position={[r.lat, r.lng]} icon={createIcon(r.name)}>
          <Popup className="premium-popup">
            <div className="font-sans flex flex-col items-center min-w-[140px]">
              <span className="font-bold text-sm text-slate-900 mb-1 text-center leading-tight">{r.name}</span>
              <span className="text-[10px] uppercase text-brand-primary-text font-black mb-3">{r.type}</span>
              <Link
                href={`/retailer/${r.id}`}
                className="text-xs bg-brand-primary-fill-strong hover:brightness-110 text-white font-bold px-4 py-1.5 rounded w-full text-center transition-all shadow"
              >
                View Directory
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
