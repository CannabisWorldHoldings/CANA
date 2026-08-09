import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function run() {
  console.log('Starting Real ETL Pipeline: ABCA Feed -> StagingABCARetailer -> Retailer');
  
  const csvPath = path.join(__dirname, 'real_abca_feed.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const lines = fileContent.trim().split('\n');
  console.log(`Found ${lines.length - 1} records in the raw CSV.`);

  let staged = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // simple csv parser handling quoted strings
    const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g, '').trim());
    
    // Indices based on the real ABCA Open Data format:
    // 3: ABCA_NUMBER, 5: ADDRESS, 6: FACILITY_TYPE, 7: STATUS, 10: TRADE_NAME, 21: LATITUDE, 22: LONGITUDE
    // Uppercase to keep entity resolution stable across engines: PostgreSQL
    // unique lookups are case-sensitive, so a feed that flips case between
    // runs would otherwise create duplicate staging rows and duplicate
    // retailers (P2002) instead of matching the existing record.
    const licenseNumber = values[3]?.trim().toUpperCase();
    const tradeName = values[10] || values[4]; // fallback to NAME if TRADE_NAME empty
    const address = values[5];
    const status = values[7];
    const facilityType = values[6];
    
    if (!licenseNumber) continue;

    const record = {
      tradeName: tradeName,
      licenseNumber: licenseNumber,
      address: address,
      status: status,
      rawJson: JSON.stringify({
        TRADE_NAME: tradeName,
        ABCA_NUMBER: licenseNumber,
        ADDRESS: address,
        STATUS: status,
        FACILITY_TYPE: facilityType,
        LATITUDE: values[21],
        LONGITUDE: values[22]
      })
    };
    
    await prisma.stagingABCARetailer.upsert({
      where: { licenseNumber: record.licenseNumber },
      update: record,
      create: record
    });
    staged++;
  }
  
  console.log(`Successfully ingested ${staged} records into StagingABCARetailer.`);
  
  // Phase 2: Staging to Retailer
  const stagingRecords = await prisma.stagingABCARetailer.findMany();
  console.log(`Promoting ${stagingRecords.length} records to Retailer...`);
  
  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const record of stagingRecords) {
    let raw;
    try {
      raw = JSON.parse(record.rawJson || '{}');
    } catch {
      raw = {};
    }

    let retailer = await prisma.retailer.findUnique({
      where: { licenseNumber: record.licenseNumber }
    });
    
    if (!retailer) {
      const potentialMatches = await prisma.retailer.findMany({
        where: { name: { contains: record.tradeName, mode: 'insensitive' } }
      });
      if (potentialMatches.length === 1) {
        retailer = potentialMatches[0];
      }
    }
    
    const isActive = record.status?.toLowerCase() === 'active';
    const isPending = record.status?.toLowerCase() === 'pending';
    const mappedStatus = isActive ? 'VERIFIED' : (isPending ? 'PENDING' : 'EXPIRED');

    const lat = parseFloat(raw.LATITUDE);
    const lng = parseFloat(raw.LONGITUDE);

    if (retailer) {
      await prisma.retailer.update({
        where: { id: retailer.id },
        data: {
          licenseNumber: record.licenseNumber,
          licenseStatus: mappedStatus,
          licenseSource: 'DC ABCA Registry (ETL)',
          lastLicenseCheck: new Date(),
          dataStatus: isActive ? 'VERIFIED_CURRENT' : 'AWAITING_VERIFICATION',
        }
      });
      updated++;
    } else {
      if (isActive || isPending) {
        await prisma.retailer.create({
          data: {
            name: record.tradeName || 'Unknown Name',
            type: raw.FACILITY_TYPE?.toLowerCase().includes('courier') ? 'delivery' : 'storefront',
            address: record.address || 'Unknown Address',
            city: 'Washington',
            state: 'DC',
            lat: !isNaN(lat) ? lat : 38.9, 
            lng: !isNaN(lng) ? lng : -77.0,
            licenseNumber: record.licenseNumber,
            licenseStatus: mappedStatus,
            licenseSource: 'DC ABCA Registry (ETL)',
            lastLicenseCheck: new Date(),
            dataStatus: isActive ? 'VERIFIED_CURRENT' : 'AWAITING_VERIFICATION',
            dataSource: 'DC ABCA Registry',
          }
        });
        created++;
      } else {
        skipped++;
      }
    }
  }
  
  console.log(`ETL Promotion Complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
}

run()
  .catch(e => {
    console.error("ETL Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
