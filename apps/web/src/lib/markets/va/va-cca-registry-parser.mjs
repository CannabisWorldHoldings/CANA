// VA CCA REGISTRY PARSER — Virginia Pre-Entry slice 1 (Transfer Test #1).
//
// LAWS (mirrors the D.C. reality doctrine):
//   - This parser produces EXTRACTED STATEMENTS from an official CCA page
//     snapshot. It never produces verified world state by itself.
//   - Every record carries source provenance sufficient to reconstruct the
//     extraction: source URL, page sha256, extraction rule version.
//   - Unknown fields stay absent — never defaulted, never guessed.
//   - Promotion to VERIFIED_BY_REGULATOR happens downstream in the reality
//     lane (see docs/markets/VIRGINIA_PRE_ENTRY.md, slice 2 wiring into
//     src/lib/reality/* alongside live-abca-adapter.mjs), never here.
//
// The CCA site (cca.virginia.gov, Squarespace) renders each facility as a
// text block: a `sqsrte-large` paragraph holding the display name, followed
// by an address paragraph ("STREET<br>CITY, VA ZIP"), then labeled Phone /
// Website paragraphs. This parser is deliberately dependency-free and works
// on both the full page HTML and the trimmed court fixtures (the trim rule
// preserves the content blocks byte-for-byte).

export const VA_CCA_PARSER_RULE_VERSION = 'va-cca-parse/1';

const BLOCK_RE = /<div class="sqs-html-content"[^>]*>([\s\S]*?)<\/div>/g;
const NAME_RE = /<p class="sqsrte-large"[^>]*>([\s\S]*?)<\/p>/;
const PARA_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
const ADDRESS_RE = /^(.*?)(?:<br\s*\/?>)+\s*([^<,]+),\s*(VA|Virginia)\.?\s+(\d{5})(?:-\d{4})?\s*$/i;
const TEL_RE = /href="tel:([+\d]+)"/;
const SITE_RE = /href="(https?:\/\/[^"]+)"/g;

function textOf(htmlFragment) {
  return htmlFragment
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a CCA registry page (dispensaries or processors) into extracted
 * facility statements.
 *
 * @param {string} html      Full page HTML or trimmed fixture HTML.
 * @param {object} source    { url, pageSha256 } — provenance, caller-supplied.
 * @returns {{ records: Array<object>, rejects: Array<object> }}
 *   records: extracted facility statements (state VA only, deduplicated).
 *   rejects: content blocks that had a large-name paragraph but failed the
 *            address law — preserved so the court can see what was NOT
 *            extracted (silence must be inspectable).
 */
export function parseCcaRegistryPage(html, source = {}) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('parseCcaRegistryPage: html must be a nonempty string');
  }
  const records = [];
  const rejects = [];
  const seen = new Set();

  for (const blockMatch of html.matchAll(BLOCK_RE)) {
    const block = blockMatch[1];
    const nameMatch = block.match(NAME_RE);
    if (!nameMatch) continue; // not a facility block (nav, prose, etc.)
    const name = textOf(nameMatch[1]);
    if (!name) continue;

    let address = null;
    for (const para of block.matchAll(PARA_RE)) {
      const inner = para[1];
      if (inner === nameMatch[1]) continue;
      const addr = inner.trim().match(ADDRESS_RE);
      if (addr) {
        address = {
          street: textOf(addr[1]),
          city: textOf(addr[2]),
          state: 'VA',
          zip: addr[4],
        };
        break;
      }
    }

    if (!address) {
      rejects.push({ name, reason: 'NO_VA_ADDRESS_LAW_MATCH' });
      continue;
    }

    const dedupeKey = `${name.toLowerCase()}|${address.street.toLowerCase()}|${address.zip}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const record = {
      statementType: 'CCA_REGISTRY_LISTING',
      name,
      address,
      provenance: {
        sourceUrl: source.url ?? null,
        pageSha256: source.pageSha256 ?? null,
        parserRule: VA_CCA_PARSER_RULE_VERSION,
      },
    };
    const tel = block.match(TEL_RE);
    if (tel) record.phone = tel[1];
    const site = [...block.matchAll(SITE_RE)]
      .map((m) => m[1])
      .find((u) => !u.startsWith('https://www.cca.virginia.gov'));
    if (site) record.website = site;

    records.push(record);
  }

  return { records, rejects };
}

const ACCORDION_TITLE_RE = /<span class="accordion-item__title">([^<]+)<\/span>/;
const HSA_RE = /Health Service Area\s+(\d)/i;
const OPERATOR_LINK_RE = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

/**
 * Parse the CCA processors page's region accordion into extracted processor
 * statements. The CCA renders pharmaceutical processors as accordion items:
 * region title + a description naming the Health Service Area and linking
 * the operator's site. Same laws as parseCcaRegistryPage: extraction only,
 * provenance bound, unknowns absent, non-matches inspectable.
 */
export function parseCcaProcessorAccordion(html, source = {}) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('parseCcaProcessorAccordion: html must be a nonempty string');
  }
  const records = [];
  const rejects = [];
  const items = html.split('<li class="accordion-item"').slice(1);

  for (const chunk of items) {
    const item = chunk.slice(0, chunk.indexOf('</li>'));
    const title = item.match(ACCORDION_TITLE_RE);
    if (!title) continue;
    const region = textOf(title[1]);
    const hsa = item.match(HSA_RE);
    if (!hsa) {
      rejects.push({ region, reason: 'NO_HSA_LAW_MATCH' });
      continue;
    }
    const operators = [...item.matchAll(OPERATOR_LINK_RE)]
      .filter(([, url]) => !url.includes('cca.virginia.gov'))
      .map(([, url, label]) => ({ name: textOf(label), website: url }))
      .filter((o) => o.name.length > 1);
    if (operators.length === 0) {
      rejects.push({ region, reason: 'NO_OPERATOR_LINK' });
      continue;
    }
    const descText = textOf(item);
    const record = {
      statementType: 'CCA_PROCESSOR_LISTING',
      region,
      healthServiceArea: Number(hsa[1]),
      operator: operators[0],
      provenance: {
        sourceUrl: source.url ?? null,
        pageSha256: source.pageSha256 ?? null,
        parserRule: VA_CCA_PARSER_RULE_VERSION,
      },
    };
    if (/conditional approval/i.test(descText)) {
      record.statusText = 'CONDITIONAL_APPROVAL';
    }
    records.push(record);
  }

  return { records, rejects };
}
