#!/usr/bin/env node
// ORDERWEEDDC demo builder — injects exact brand assets, the 74-record
// regulator dataset, generated imagery, film URLs, and the live map into
// template.html. All inputs live in ./assets (nothing volatile).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const A = (f) => fs.readFileSync(path.join(DIR, 'assets', f), 'utf8').trim();
let html = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
// JSON-LD: machine-readable registry (schema.org) — registry facts only.
const RECS = JSON.parse(A('records.json'));
const jsonld = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'ItemList',
  name: 'Licensed cannabis retailers — Washington, D.C. (DC ABCA registry, snapshot 2026-06-05)',
  numberOfItems: RECS.length,
  itemListElement: RECS.map((r, i) => ({ '@type': 'ListItem', position: i + 1, item: {
    '@type': 'Store', name: r.n, identifier: r.a,
    address: { '@type': 'PostalAddress', streetAddress: r.ad, addressLocality: 'Washington', addressRegion: 'DC' },
    geo: { '@type': 'GeoCoordinates', latitude: r.lat, longitude: r.lon },
  }})),
});
html = html.split('{{JSONLD}}').join('<script type="application/ld+json">' + jsonld.replace(/</g, '\\u003c') + '</scr' + 'ipt>');
const sub = {
  '{{LOGO_DARK}}': A('logo-dark-bg.b64'),
  '{{LOGO_LIGHT}}': A('logo-light-bg.b64'),
  '{{RECORDS}}': A('records.json'),
  '{{IMG_HERO}}': A('vivid-hero.b64'),
  '{{IMG_RIBBON}}': A('vivid-ribbon.b64'),
  '{{IMG_BOTANICAL}}': A('vivid-botanical.b64'),
  '{{IMG_ROWHOUSE}}': A('vivid-rowhouse.b64'),
  '{{IMG_INTERIOR}}': A('vivid-interior.b64'),
  '{{IMG_COURIER}}': A('vivid-courier.b64'),
  '{{FILM_URL}}': 'https://pub.hyperagent.com/api/published/pbf01M0B7P96F_T632DGK5TF4KBSA9/b2196e0c-b0d1-4115-b14c-3897b1a13f99.mp4',
  '{{FILM_FALLBACK}}': 'https://hyperagent.com/api/files/usergenerated/threads/cmsxmgvpx3pr108adgpmk22wv/media/b2196e0c-b0d1-4115-b14c-3897b1a13f99.mp4',
  '{{MAP_URL}}': 'https://hyperagent.com/api/files/usergenerated/threads/cmsxmgvpx3pr108adgpmk22wv/artifacts/342928c0-1f32-4205-9f05-33e1caa14261.html',
};
for (const [k, v] of Object.entries(sub)) html = html.split(k).join(v);
const left = html.match(/{{[A-Z_]+}}/g);
if (left) { console.error('UNRESOLVED:', left); process.exit(1); }
fs.writeFileSync(path.join(DIR, 'index.html'), html);
console.log('built index.html:', (html.length / 1048576).toFixed(2) + 'MB');
