// MD MCA REGISTRY PARSER — Maryland Transfer Test #2 (compiler claim test).
//
// Same laws as the VA parser (extraction only; provenance-bound; unknown
// fields absent; rejects inspectable), adapted to the MCA's SharePoint table:
// each <td> cell holds zero or more facility entries as <br>-separated lines —
// name (often <strong>), street line(s), "City, MD ZIP", phone, links.
//
// The MCA page (like the VA CCA registry pages) publishes NO license numbers —
// Maryland identity is therefore name+address versioned, same as Virginia.

export const MD_MCA_PARSER_RULE_VERSION = 'md-mca-parse/1';

const CELL_RE = /<td[^>]*>([\s\S]*?)<\/td>/g;
const CITY_LINE_RE = /^(.+?),\s*MD\s+(\d{5})(?:-\d{4})?$/i;
const PHONE_RE = /(\d{3})[-.\s](\d{3})[-.\s](\d{4})/;
const SITE_RE = /href="(https?:[^"]+)"/g;

function decodeEntities(value) {
  return value
    .replace(/&#58;/g, ':')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8203;|​|‌/g, '')
    .replace(/&#39;|&rsquo;|’/g, "'");
}

function cellLines(cellHtml) {
  const decoded = decodeEntities(cellHtml)
    // Operator names are often published only as a logo's alt text — recover
    // the alt attribute as a text line before tags are stripped.
    .replace(/<img[^>]*\balt="([^"]+)"[^>]*>/gi, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[email\s*protected\]/gi, '');
  return decoded
    // Some cells glue the street to the city line without a break — split at
    // the ", MD ZIP" seam's case boundary so the address law can hold.
    .replace(/([a-z.])([A-Z][a-zA-Z .'-]*,\s*MD\s+\d{5})/g, '$1\n$2')
    .replace(/(Unit [A-Z])([A-Z][a-z][a-zA-Z .'-]*,\s*MD\s+\d{5})/g, '$1\n$2')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/**
 * Parse the MCA dispensaries table into extracted facility statements.
 * @param {string} html   Full page HTML or trimmed fixture HTML.
 * @param {object} source { url, pageSha256 } provenance, caller-supplied.
 */
export function parseMcaRegistryPage(html, source = {}) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('parseMcaRegistryPage: html must be a nonempty string');
  }
  const records = [];
  const rejects = [];
  const seen = new Set();

  for (const cellMatch of html.matchAll(CELL_RE)) {
    const cellHtml = cellMatch[1];
    const lines = cellLines(cellHtml);
    if (lines.length === 0) continue;

    // Split the cell into entries: each "City, MD ZIP" line closes an entry.
    // NAME CARRY-FORWARD LAW: the MCA lists multiple locations under a single
    // operator heading — an entry whose lines are all street-shaped inherits
    // the most recent operator name seen in the same cell. Never invented:
    // with no prior name in the cell, the entry is rejected, not guessed.
    let start = 0;
    let lastName = null;
    for (let index = 0; index < lines.length; index += 1) {
      const cityMatch = lines[index].match(CITY_LINE_RE);
      if (!cityMatch) continue;
      const block = lines.slice(start, index);
      start = index + 1;

      const meaningful = block.filter(
        (line) => !/^https?:/i.test(line) && !PHONE_RE.test(line) && !line.includes('@'),
      );
      if (meaningful.length === 0) {
        rejects.push({ reason: 'NO_NAME_OR_STREET_BEFORE_CITY_LINE', city: cityMatch[1] });
        continue;
      }
      const streetShaped = (line) => /^\d/.test(line) || /^(suite|ste\.?|unit|#)/i.test(line);
      let name;
      let streetLines;
      if (streetShaped(meaningful[0])) {
        name = lastName;
        streetLines = meaningful;
      } else {
        name = meaningful[0].replace(/[​]+/g, '').trim();
        streetLines = meaningful.slice(1);
      }
      const street = streetLines.join(', ') || null;
      if (!street || street.length < 5) {
        rejects.push({ reason: 'ENTRY_INCOMPLETE', name: name || null, city: cityMatch[1] });
        continue;
      }
      // A location the regulator publishes without any name text stays a
      // record — with the name explicitly ABSENT, never invented from URLs.
      const named = typeof name === 'string' && name.length >= 3;
      if (named) lastName = name;
      const address = {
        street,
        city: cityMatch[1].replace(/\s+/g, ' ').trim(),
        state: 'MD',
        zip: cityMatch[2],
      };
      const dedupeKey = `${named ? name.toLowerCase() : 'NAME_UNPUBLISHED'}|${address.street.toLowerCase()}|${address.zip}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const record = {
        statementType: 'MCA_REGISTRY_LISTING',
        ...(named ? { name } : {}),
        address,
        provenance: {
          sourceUrl: source.url ?? null,
          pageSha256: source.pageSha256 ?? null,
          parserRule: MD_MCA_PARSER_RULE_VERSION,
        },
      };
      // phone/website: search the remainder of the cell after this entry's
      // city line but before the next entry's name (approximation: nearest
      // following lines until another entry begins).
      const tail = lines.slice(index + 1, index + 4).join(' ');
      const phone = tail.match(PHONE_RE) ?? block.join(' ').match(PHONE_RE);
      if (phone) record.phone = `${phone[1]}-${phone[2]}-${phone[3]}`;
      const site = [...decodeEntities(cellHtml).matchAll(SITE_RE)]
        .map((m) => m[1])
        .find((u) => !u.includes('cannabis.maryland.gov') && !u.includes('PublishingImages'));
      if (site) record.website = site;

      records.push(record);
    }
  }
  return { records, rejects };
}
