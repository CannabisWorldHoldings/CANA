import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function run() {
  const csvPath = path.join(__dirname, 'mock_abca_feed.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf8');
  
  const lines = fileContent.trim().split('\n');
  console.log(`Found ${lines.length - 1} records to ingest.`);

  let inserted = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // simple csv parser handling quoted strings
    const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^"|"$/g, '').trim());
    
    const record = {
      tradeName: values[0],
      // Uppercase to keep entity resolution stable: PostgreSQL unique
      // constraints are case-sensitive, so "abca-1001" and "ABCA-1001"
      // would otherwise stage as two different licenses.
      licenseNumber: values[1]?.trim().toUpperCase(),
      address: values[2],
      status: values[3],
      rawJson: JSON.stringify({
        Trade_Name: values[0],
        License_Number: values[1],
        Address: values[2],
        Status: values[3]
      })
    };
    
    await prisma.stagingABCARetailer.upsert({
      where: { licenseNumber: record.licenseNumber },
      update: record,
      create: record
    });
    inserted++;
  }
  
  console.log(`Successfully ingested ${inserted} records into StagingABCARetailer.`);
}

run()
  .catch(e => {
    console.error("Error during ingestion:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
