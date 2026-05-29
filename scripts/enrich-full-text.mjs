import fs from 'fs/promises';

const DATA_FILE = new URL('../public/data/executive-orders.json', import.meta.url);
const OUTPUT_FILE = new URL('../public/data/executive-orders-full-text.json', import.meta.url);

const USER_AGENT = 'executive-orders-dashboard-enrichment/1.0 (+https://github.com/HoAtRiP/executive-orders-dashboard)';
const RATE_LIMIT_MS = 1000; // 1 second between requests
const TIMEOUT_MS = 30000; // 30 second timeout per request

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const stripTagsAndNormalize = (s) => {
  if (!s) return '';
  // Remove XML/HTML tags
  let text = s.replace(/<[^>]+>/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
};

const parseArgs = (args) => {
  const opts = { limit: null, start: 0, all: false };
  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      opts.limit = parseInt(arg.slice(8), 10);
    } else if (arg.startsWith('--start=')) {
      opts.start = parseInt(arg.slice(8), 10);
    } else if (arg === '--all') {
      opts.all = true;
    }
  }
  return opts;
};

async function fetchText(url) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      return { ok: true, body };
    } finally {
      clearTimeout(id);
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function enrichRecord(rec, index) {
  const eo = rec.executive_order_number ?? 'unknown';
  const url = rec.full_text_xml_url || rec.json_url;
  const source = rec.full_text_xml_url ? 'xml' : rec.json_url ? 'json' : null;

  let plain = '';
  let status = 'missing_source';
  let errorMsg = null;
  let fetchedAt = null;

  if (url) {
    const start = Date.now();
    const res = await fetchText(url);
    fetchedAt = new Date().toISOString();

    if (res.ok) {
      plain = stripTagsAndNormalize(res.body);
      status = 'fetched';
    } else {
      status = 'error';
      errorMsg = res.error;
    }

    // Respect rate limit
    const elapsed = Date.now() - start;
    if (elapsed < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - elapsed);
  }

  const enriched = {
    executive_order_number: rec.executive_order_number ?? null,
    document_number: rec.document_number ?? null,
    title: rec.title ?? null,
    president: rec.president ?? null,
    signing_date: rec.signing_date ?? null,
    publication_date: rec.publication_date ?? null,
    citation: rec.citation ?? null,
    html_url: rec.html_url ?? null,
    pdf_url: rec.pdf_url ?? null,
    json_url: rec.json_url ?? null,
    full_text_xml_url: rec.full_text_xml_url ?? null,
    full_text_source: source,
    full_text_status: status,
    full_text_last_fetched: fetchedAt,
    full_text_plain: plain,
    full_text_plain_length: plain.length,
  };

  if (errorMsg) {
    enriched.full_text_error = errorMsg;
  }

  const statusIcon = status === 'fetched' ? '✓' : status === 'error' ? '✗' : '−';
  console.log(`[${index}] ${statusIcon} EO ${eo}: ${status}`);

  return enriched;
}

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const records = JSON.parse(raw);

  const total = records.length;
  const start = opts.start || 0;
  const limit = opts.limit || null;
  const end = limit ? Math.min(start + limit, total) : total;

  console.log(`\n📊 Full-text enrichment started`);
  console.log(`   Total records: ${total}`);
  console.log(`   Start index: ${start}`);
  console.log(`   Limit: ${limit || 'none'}`);
  console.log(`   Processing: ${start} to ${end - 1} (${end - start} records)\n`);

  const output = [];

  for (let i = start; i < end; i++) {
    const rec = records[i];
    const enriched = await enrichRecord(rec, i);
    output.push(enriched);
  }

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const succeeded = output.filter((r) => r.full_text_status === 'fetched').length;
  const missing = output.filter((r) => r.full_text_status === 'missing_source').length;
  const errored = output.filter((r) => r.full_text_status === 'error').length;

  console.log(`\n✨ Enrichment complete`);
  console.log(`   Fetched: ${succeeded}`);
  console.log(`   Missing source: ${missing}`);
  console.log(`   Errors: ${errored}`);
  console.log(`   Output: ${OUTPUT_FILE.pathname}\n`);
}

main().catch((err) => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
