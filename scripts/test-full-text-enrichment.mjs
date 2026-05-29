import fs from 'fs/promises';

const DATA_FILE = new URL('../public/data/executive-orders.json', import.meta.url);
const OUTPUT_FILE = new URL('../public/data/sample-full-text-enrichment.json', import.meta.url);

const USER_AGENT = 'executive-orders-dashboard-test/1.0 (dev)';
const RATE_LIMIT_MS = 1000; // 1 second between requests
const PREVIEW_LIMIT = 2000;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const stripTagsAndNormalize = (s) => {
  if (!s) return '';
  // Remove XML/HTML tags
  let text = s.replace(/<[^>]+>/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
};

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function main() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const records = JSON.parse(raw);

  const withXml = records.filter((r) => r.full_text_xml_url).slice(0, 3);

  const output = [];

  for (const rec of withXml) {
    const url = rec.full_text_xml_url;
    const start = Date.now();
    const res = await fetchText(url);
    const fetchedAt = new Date().toISOString();

    let plain = '';
    let status = 'not_fetched';

    if (res.ok) {
      plain = stripTagsAndNormalize(res.body);
      status = 'fetched';
    } else {
      status = 'error';
    }

    const preview = plain.slice(0, PREVIEW_LIMIT);

    output.push({
      executive_order_number: rec.executive_order_number ?? null,
      title: rec.title ?? null,
      president: rec.president ?? null,
      signing_date: rec.signing_date ?? null,
      publication_date: rec.publication_date ?? null,
      full_text_url: url,
      full_text_source: 'xml',
      full_text_status: status,
      full_text_last_fetched: res.ok ? fetchedAt : null,
      full_text_plain_preview: preview,
      full_text_plain_length: plain.length,
    });

    // Respect rate limit
    const elapsed = Date.now() - start;
    if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
  }

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${output.length} sample records to ${OUTPUT_FILE.pathname}`);
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});
