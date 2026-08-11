# Live source registry

Exactly one source is admitted:

- Source: DC ABCA licensed medical cannabis retailer locations
- Source ID: `dcgis:abca:licensed-medical-cannabis-retailers:layer-31`
- Source key: `dcgis_abca_retailers_layer_31`
- Endpoint: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31`
- Network authority: owner-opted maintenance CLI only
- Authentication: none
- Cost: zero dollars observed; no provider billing authority
- Authoritative predicates: license number, license status, regulated address, operating status

Endpoint, hostname, path, layer, query, field list, ordering, record limit, and time/byte budgets are fixed in `ABCA_LIVE_CONTRACT`. A source ID alone cannot preserve authority after a contract change.
