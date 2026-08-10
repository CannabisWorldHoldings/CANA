# Source authority matrix

| Source/evidence | Admitted meaning | Explicitly not admitted | Freshness |
|---|---|---|---|
| DCGIS Layer 31 committed response | Positive presence in the layer; exact ABCA number; recorded status; recorded regulated address; operational-list status | Completeness of all DC licenses, absent-business unlicensed status, separately listed internet-only coverage, hours, phone, menu, inventory, price, delivery area, quality, demand, value | 30 days from catalog-modified observation time, bounded earlier by license expiration |
| `ABCA_NUMBER` | Exact external identity evidence linking to one canonical retailer | Name/address similarity or ownership proof | Same source window |
| DCGIS `GLOBALID`/`OBJECTID` | Source record aliases and replay metadata | CANA sovereign identity | Same source window |
| Existing merchant or user submission | Review input only | Official license truth or public eligibility | According to its own review policy |
| Market-gap signal | A verified customer query returned zero current candidates | Demand, revenue, conversion, or permission to create supply | Signal/mission expiry |
| Site Intelligence observation | Count of persisted states at a snapshot | Truth mutation, publishing, causal proof, or cognitive promotion | Snapshot time only |

Official endpoints retained in the source contract:

- DCGIS layer: <https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Health_WebMercator/MapServer/31>
- Data catalog entry: <https://catalog.data.gov/dataset/licensed-medical-cannabis-retailers>
- ABCA operational list: <https://abca.dc.gov/am/node/1751426>

The ArcGIS layer is the machine-readable source. The ABCA page is a legal/operational assertion and cross-check, not an undocumented API.
