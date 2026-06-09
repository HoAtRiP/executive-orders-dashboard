import fs from 'fs/promises';

const INPUT_FILE = new URL('../public/data/opm-chcoc-raw.json', import.meta.url);
const OUTPUT_FILE = new URL('../public/data/opm-chcoc-text-sample.json', import.meta.url);
const USER_AGENT = 'executive-orders-dashboard-opm-chcoc-text-test/1.0 (+https://github.com/HoAtRiP/executive-orders-dashboard)';
const FETCH_TIMEOUT_MS = 30000;
const DEFAULT_SAMPLE_SIZE = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseSampleSize = (value) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_SIZE;
};

const fetchPdfParse = async () => {
  const pdfParseModule = await import('pdf-parse');
  return pdfParseModule.PDFParse;
};

const stripHtmlEntities = (value) => {
  if (!value) return '';

  return value
    .replace(/&amp;amp;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—');
};

const normalizeText = (value) => {
  if (!value) return '';
  return stripHtmlEntities(value).replace(/\s+/g, ' ').trim();
};

const fetchPdfBuffer = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/pdf,*/*',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
};

const extractPdfText = async (pdfParse, url) => {
  const buffer = await fetchPdfBuffer(url);
  const parser = new pdfParse({ data: buffer });

  try {
    const parsed = await parser.getText();
    const text = normalizeText(parsed?.text ?? '');

    return {
      text,
      textAvailable: text.length > 0,
    };
  } finally {
    await parser.destroy();
  }
};

const buildOutputRecord = (record, textAvailable, extractedText, extractionError) => {
  const outputRecord = {
    title: record.title ?? null,
    date: record.date ?? null,
    year: record.year ?? null,
    from: record.from ?? null,
    reference_id: record.reference_id ?? null,
    stakeholders: record.stakeholders ?? null,
    pdf_url: record.pdf_url ?? null,
    source_link_type: record.source_link_type ?? null,
    text_available: Boolean(textAvailable),
    extracted_text: extractedText,
  };

  if (extractionError) {
    outputRecord.extraction_error = extractionError;
  }

  return outputRecord;
};

async function main() {
  const sampleSize = parseSampleSize(process.argv[2]);
  const pdfParse = await fetchPdfParse();

  console.log(`Input file: ${INPUT_FILE.pathname}`);
  console.log(`Sample size: ${sampleSize}`);

  const raw = await fs.readFile(INPUT_FILE, 'utf8');
  const records = JSON.parse(raw);

  const pdfRecords = records.filter((record) => record.source_link_type === 'pdf' && record.pdf_url);
  const sampleRecords = pdfRecords.slice(0, sampleSize);

  console.log(`PDF records available: ${pdfRecords.length}`);
  console.log(`Number of PDFs attempted: ${sampleRecords.length}`);

  const output = [];
  let successes = 0;
  let failures = 0;

  for (const [index, record] of sampleRecords.entries()) {
    try {
      console.log(`Fetching PDF ${index + 1}/${sampleRecords.length}: ${record.pdf_url}`);
      const { text, textAvailable } = await extractPdfText(pdfParse, record.pdf_url);
      if (textAvailable) {
        successes += 1;
      } else {
        failures += 1;
      }
      output.push(buildOutputRecord(record, textAvailable, text, textAvailable ? null : 'Readable text could not be extracted'));
    } catch (error) {
      failures += 1;
      output.push(buildOutputRecord(record, false, '', error instanceof Error ? error.message : String(error)));
    }

    if (index < sampleRecords.length - 1) {
      await sleep(250);
    }
  }

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`Number of successful text extractions: ${successes}`);
  console.log(`Number of failed text extractions: ${failures}`);
  console.log(`Output file path: ${OUTPUT_FILE.pathname}`);
}

main().catch((error) => {
  console.error('OPM/CHCOC PDF text extraction test failed:', error);
  process.exit(1);
});