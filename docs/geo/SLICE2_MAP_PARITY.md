# Slice 2 — Leaflet parity requirements and MapLibre replacement contract

Rule: **do not throw away Leaflet until parity is proven.** This document is
the verified inventory of current map behavior (inspected at commit 8983cc3)
and the contract the MapLibre surface must meet before the default flips.

## Verified current behavior (Leaflet 1.9 + react-leaflet 5 + CARTO raster)

| # | Behavior | Where | Notes |
|---|---|---|---|
| P1 | Map renders client-only via `dynamic(..., { ssr: false })` with pulse-skeleton loading state | `retailer-map-loader.tsx` | Loader text: "Initializing Interactive Map..." |
| P2 | Tiles: CARTO Voyager raster (`basemaps.cartocdn.com/rastertiles/voyager`), OSM attribution | `retailer-map.tsx` | Free, keyless |
| P3 | Default center: Washington DC (38.9072, −77.0369), zoom 12 | `retailer-map.tsx` | |
| P4 | Auto fit-bounds to the retailer set (padding 50, maxZoom 14, 100 ms defer) | `MapBoundsUpdater` | |
| P5 | Marker = circular div icon, first letter of name, brand colors, hover scale; sponsored variant styled differently (scale-110, brand-primary) | `createIcon` | **Sponsored variant exists in code but is never passed** — `isSponsored` defaults false and the caller never sends it. Parity = replicate the rendered behavior, not the dead parameter |
| P6 | Popup: name, type label, "View Directory" link to `/retailer/{id}` | Leaflet `Popup` | |
| P7 | `scrollWheelZoom` disabled | `MapContainer` | Prevents page-scroll hijack |
| P8 | Input data: `{id,name,lat,lng,type}` mapped server-side from the SAME `directoryRetailerWhere` query as the list — map and list are inherently synchronized by construction | `[domain]/page.tsx:663` | Evidence-gating inherited: `directoryRetailerWhere` already applies truth-state constraints |
| P9 | Fixed-height panel (380 px mobile / 500 px sm+), rounded, on the homepage right column | `[domain]/page.tsx:662` | |
| P10 | No clustering, no viewport queries (all page results rendered as markers, bounded by directory page size), no geolocation, no isochrones | — | Current ceiling, not parity requirements |

## Parity gate (must ALL pass before the default engine flips)

- [ ] G1: renders the same marker set as Leaflet for identical inputs (P8)
- [ ] G2: skeleton/loading state present (P1)
- [ ] G3: DC default center/zoom when no retailers (P3)
- [ ] G4: fit-bounds on the marker set (P4)
- [ ] G5: marker visual language preserved (initial, brand colors, hover) (P5)
- [ ] G6: popup/card with name, type, link to retailer page (P6)
- [ ] G7: no scroll-wheel page hijack (P7)
- [ ] G8: mobile height behavior (P9)
- [ ] G9: keyboard/AT accessible marker interactions (improvement, required)
- [ ] G10: no business logic in the rendering layer — data arrives as a finished `PublicMapProjection`

## Beyond parity (Slice 2 scope, additive)

- Viewport-based PostGIS querying via `/api/geo/viewport` (geo-repository)
- H3 parent-cell clustering at low zooms (res 7) from `countEntitiesByH3Parent`
- Evidence-gated claim rendering: hours/status/deals appear ONLY from
  decision-eligible claims; otherwise the UI shows an explicit unknown state
- Near Me with explicit browser permission prompt and graceful denial
- Provider-neutral style abstraction (`tile-sources.mjs`): CARTO raster today,
  MapTiler/PMTiles as config swaps later

## Rollout / rollback

Engine selection is a server-rendered switch: `CANA_MAP_ENGINE=leaflet|maplibre`
(default **leaflet** until the parity gate is green). Rollback = unset one env
var. Leaflet code is not deleted in Slice 2 at all; deletion is a separate PR
after the flip has soaked in production.
