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

const getRecordKey = (rec) => {
  // Primary key: document_number
  if (rec.document_number) return rec.document_number;
  // Fallback key: composite
  return `${rec.executive_order_number ?? ''}|${rec.publication_date ?? ''}|${rec.signing_date ?? ''}`;
};

const parseEoNumber = (val) => {
  if (val == null || String(val).trim() === '') return Number.NEGATIVE_INFINITY;
  const n = Number(String(val).replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
};

const sortEnrichedRecords = (records) => {
  return [...records].sort((a, b) => {
    // 1. signing_date descending
    const signingDateA = a.signing_date ? new Date(a.signing_date).getTime() : 0;
    const signingDateB = b.signing_date ? new Date(b.signing_date).getTime() : 0;
    if (signingDateB !== signingDateA) return signingDateB - signingDateA;

    // 2. publication_date descending
    const pubDateA = a.publication_date ? new Date(a.publication_date).getTime() : 0;
    const pubDateB = b.publication_date ? new Date(b.publication_date).getTime() : 0;
    if (pubDateB !== pubDateA) return pubDateB - pubDateA;

    // 3. executive_order_number descending (numeric)
    const numA = parseEoNumber(a.executive_order_number);
    const numB = parseEoNumber(b.executive_order_number);
    return numB - numA;
  });
};

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const records = JSON.parse(raw);

  const total = records.length;
  const start = opts.start || 0;
  const limit = opts.limit || null;
  const end = limit ? Math.min(start + limit, total) : total;

  // Load existing enriched records if they exist
  let existingEnriched = [];
  try {
    const existingRaw = await fs.readFile(OUTPUT_FILE, 'utf8');
    existingEnriched = JSON.parse(existingRaw);
  } catch {
    // File doesn't exist yet, start fresh
  }

  const existingCount = existingEnriched.length;

  console.log(`\n📊 Full-text enrichment started`);
  console.log(`   Total records available: ${total}`);
  console.log(`   Existing enriched records: ${existingCount}`);
  console.log(`   Start index: ${start}`);
  console.log(`   Limit: ${limit || 'none'}`);
  console.log(`   Processing: ${start} to ${end - 1} (${end - start} records)\n`);

  const newBatch = [];

  for (let i = start; i < end; i++) {
    const rec = records[i];
    const enriched = await enrichRecord(rec, i);
    newBatch.push(enriched);
  }

  // Merge: build a map of existing records by key
  const existingMap = new Map();
  for (const rec of existingEnriched) {
    const key = getRecordKey(rec);
    existingMap.set(key, rec);
  }

  // Add/update new records
  for (const rec of newBatch) {
    const key = getRecordKey(rec);
    existingMap.set(key, rec); // Update if exists, add if new
  }

  // Convert back to array and sort
  const merged = Array.from(existingMap.values());
  const sorted = sortEnrichedRecords(merged);

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(sorted, null, 2), 'utf8');

  const succeeded = newBatch.filter((r) => r.full_text_status === 'fetched').length;
  const missing = newBatch.filter((r) => r.full_text_status === 'missing_source').length;
  const errored = newBatch.filter((r) => r.full_text_status === 'error').length;

  console.log(`\n✨ Enrichment complete`);
  console.log(`   New batch fetched: ${succeeded}`);
  console.log(`   New batch missing source: ${missing}`);
  console.log(`   New batch errors: ${errored}`);
  console.log(`   Existing records preserved: ${existingCount}`);
  console.log(`   Final merged output: ${sorted.length} records`);
  console.log(`   Output: ${OUTPUT_FILE.pathname}\n`);
}

main().catch((err) => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
