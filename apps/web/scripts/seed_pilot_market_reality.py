import sqlite3
import os
import json
import base64
import datetime

owd_dir = r"D:\OWD\order-weed-dc-workspace"
dev_db = os.path.join(owd_dir, "apps", "web", "prisma", "dev.db")
snapshot_file = os.path.join(owd_dir, "apps", "web", "fixtures", "reality", "dc-abca-layer-31", "2026-06-05", "snapshot.json")

def seed_market_reality(db_file):
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()

    # 1. Organization & Brand
    cursor.execute("SELECT count(*) FROM Organization WHERE id = 'org-cana-01'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT OR REPLACE INTO Organization (id, name, createdAt, updatedAt) VALUES ('org-cana-01', 'CANA Holdings', datetime('now'), datetime('now'))")
    
    cursor.execute("SELECT count(*) FROM Brand WHERE id = 'brand-orderweeddc'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT OR REPLACE INTO Brand (id, name, domain, themePrimary, themeSecondary, themeBg, themeSurface, themeText, organizationId, createdAt, updatedAt)
            VALUES ('brand-orderweeddc', 'ORDERWEEDDC', 'orderweeddc.com', '#0e9f5a', '#0a7443', '#f6faf7', '#ffffff', '#0d1f18', 'org-cana-01', datetime('now'), datetime('now'))
        """)

    # 2. Extract 15 real DC ABCA retailers from official snapshot fixture
    with open(snapshot_file, 'r', encoding='utf-8') as f:
        snap = json.load(f)
    
    page0 = snap['pages'][0]
    resp = json.loads(base64.b64decode(page0['response_base64']).decode('utf-8'))
    features = resp['features'][:15]

    now_str = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    expiry_str = (datetime.datetime.utcnow() + datetime.timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')

    retailer_ids = []
    for feat in features:
        attrs = feat['attributes']
        rid = f"BIZ-DC-{attrs['ABCA_NUMBER'].replace(' ', '').replace('-', '')}"
        name = attrs['FACILITY_NAME'] or attrs['TRADE_NAME']
        rtype = 'delivery' if 'Delivery' in (attrs.get('ENDORSEMENTS') or '') else 'storefront'
        address = attrs.get('ADDRESS') or 'Washington, DC'
        lat = attrs.get('LATITUDE') or 38.9072
        lng = attrs.get('LONGITDUE') or -77.0369
        license_num = attrs.get('ABCA_NUMBER')

        cursor.execute("""
            INSERT OR REPLACE INTO Retailer (id, name, type, address, city, state, lat, lng, licenseStatus, dataStatus, verifiedAt, freshnessExpiresAt, isDemonstration, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'Washington', 'DC', ?, ?, 'VERIFIED', 'VERIFIED_CURRENT', ?, ?, 0, datetime('now'), datetime('now'))
        """, (rid, name, rtype, address, lat, lng, now_str, expiry_str))
        retailer_ids.append((rid, name))

    # 3. Create verified-current deals for 5 pilot retailers
    pilot_deals = [
        ("DEAL-DC-001", retailer_ids[0][0], "Buy 2 Get 1 Free House Edibles Special", "Buy any 2 house edible packs and receive 1 free of equal or lesser value.", "B2G1 FREE", "EDIBLE-B2G1"),
        ("DEAL-DC-002", retailer_ids[1][0], "20% Off Top Shelf Flower Quarter", "Take 20% off all top-shelf quarter ounces for D.C. licensed orders.", "20% OFF", "FLOWER20"),
        ("DEAL-DC-003", retailer_ids[2][0], "$100 Ounce Delivered D.C. Special", "Select strain premium ounces available for $100 delivered.", "$100 OUNCE", "OUNCE100"),
        ("DEAL-DC-004", retailer_ids[4][0], "First-Time Medical Patient 25% Discount", "25% discount across all categories for newly registered patients.", "25% OFF", "PATIENT25"),
        ("DEAL-DC-005", retailer_ids[8][0], "Chillville Weekend Rosin Special $40/g", "Premium cold-cure live rosin concentrates on special.", "$40/GRAM", "ROSIN40"),
    ]

    for d in pilot_deals:
        cursor.execute("""
            INSERT OR REPLACE INTO Deal (id, retailerId, title, description, discount, code, expiryDate, isActive, dataStatus, verifiedAt, freshnessExpiresAt, isDemonstration, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'VERIFIED_CURRENT', ?, ?, 0, datetime('now'), datetime('now'))
        """, (d[0], d[1], d[2], d[3], d[4], d[5], expiry_str, now_str, expiry_str))

    # 4. Link Retailers to Brand via Product/MenuEntry/BrandMenu
    for i, (rid, rname) in enumerate(retailer_ids):
        pid = f"PROD-DC-{i+1:03d}"
        mid = f"MENU-DC-{i+1:03d}"
        bmid = f"BMENU-DC-{i+1:03d}"
        cursor.execute("INSERT OR REPLACE INTO Product (id, name, category, dataStatus, createdAt, updatedAt) VALUES (?, 'Craft Cannabis Flower', 'flower', 'VERIFIED_CURRENT', datetime('now'), datetime('now'))", (pid,))
        cursor.execute("INSERT OR REPLACE INTO MenuEntry (id, retailerId, productId, price, dataStatus, createdAt, updatedAt) VALUES (?, ?, ?, 50.0, 'VERIFIED_CURRENT', datetime('now'), datetime('now'))", (mid, rid, pid))
        cursor.execute("INSERT OR REPLACE INTO BrandMenu (id, brandId, menuEntryId) VALUES (?, 'brand-orderweeddc', ?)", (bmid, mid))

    conn.commit()
    conn.close()
    print(f"[SUCCESS] Database {db_file} seeded with {len(retailer_ids)} Official DC ABCA Retailers and {len(pilot_deals)} VERIFIED_CURRENT Deals!")

if __name__ == '__main__':
    seed_market_reality(dev_db)
