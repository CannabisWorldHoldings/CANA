/**
 * Provider-neutral basemap style factory for MapLibre GL.
 *
 * The rendering layer never hard-codes a tile vendor. It asks this module for
 * a style; which provider answers is configuration:
 *
 *   CANA_MAP_TILE_PROVIDER = carto-raster (default) | maptiler | pmtiles
 *
 * carto-raster: the exact tiles the Leaflet implementation uses today —
 *   keyless, free, and visually identical during the parity window.
 * maptiler: vector tiles, requires NEXT_PUBLIC_MAPTILER_KEY (a scoped public
 *   token by design — never a secret).
 * pmtiles: self-hosted vector tiles from CANA-controlled object storage; the
 *   sovereignty target. Requires CANA_PMTILES_URL.
 *
 * Adding a provider = adding a case here. Nothing else in the app changes.
 */

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * MapLibre style document for the configured provider.
 * @returns {string | import('maplibre-gl').StyleSpecification}
 */
export function basemapStyle({
  provider = process.env.NEXT_PUBLIC_CANA_MAP_TILE_PROVIDER || 'carto-raster',
  maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY,
  pmtilesUrl = process.env.NEXT_PUBLIC_CANA_PMTILES_URL,
} = {}) {
  switch (provider) {
    case 'maptiler': {
      if (!maptilerKey) {
        throw new Error(
          'CANA_MAP_TILE_PROVIDER=maptiler requires NEXT_PUBLIC_MAPTILER_KEY (scoped public token).',
        );
      }
      return `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(maptilerKey)}`;
    }
    case 'pmtiles': {
      if (!pmtilesUrl) {
        throw new Error('CANA_MAP_TILE_PROVIDER=pmtiles requires NEXT_PUBLIC_CANA_PMTILES_URL.');
      }
      // Consumers must register the PMTiles protocol handler before use.
      /** @type {import('maplibre-gl').StyleSpecification} */
      const style = {
        version: 8,
        sources: {
          cana: { type: 'vector', url: `pmtiles://${pmtilesUrl}` },
        },
        // Style layers for the sovereign basemap are provisioned with the
        // tiles themselves; this stub is intentionally minimal until then.
        layers: [],
      };
      return style;
    }
    case 'carto-raster':
    default:
      /** @type {import('maplibre-gl').StyleSpecification} */
      const style = {
        version: 8,
        sources: {
          'carto-voyager': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
              'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
            attribution: CARTO_ATTRIBUTION,
          },
        },
        layers: [
          { id: 'carto-voyager', type: 'raster', source: 'carto-voyager' },
        ],
      };
      return style;
  }
}

/** Engine selector for the loader. Default stays leaflet until parity gate G1–G10 is green. */
export function selectedMapEngine(env = process.env) {
  return env.CANA_MAP_ENGINE === 'maplibre' ? 'maplibre' : 'leaflet';
}
