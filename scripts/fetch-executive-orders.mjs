import fs from 'fs/promises';
import path from 'path';

const API_BASE = 'https://www.federalregister.gov/api/v1/documents';
const OUTPUT_FILE = path.resolve('public', 'data', 'executive-orders.json');
const FIELDS = [
  'executive_order_number',
  'title',
  'citation',
  'signing_date',
  'publication_date',
  'president',
  'html_url',
  'pdf_url',
  'full_text_xml_url',
  'json_url',
  'document_number',
  'disposition_notes',
  'start_page',
  'end_page',
];

const buildUrl = (page) => {
  const url = new URL(API_BASE);
  url.searchParams.set('format', 'json');
  url.searchParams.set('per_page', '1000');
  url.searchParams.set('page', String(page));
  url.searchParams.set('include_pre_1994_docs', 'true');
  url.searchParams.append('conditions[type][]', 'PRESDOCU');
  url.searchParams.set('conditions[presidential_document_type]', 'executive_order');
  url.searchParams.set('conditions[publication_date][gte]', '1937-01-01');

  const fieldNames = [
    'body_html_url',
    'citation',
    'disposition_notes',
    'document_number',
    'end_page',
    'executive_order_number',
    'full_text_xml_url',
    'html_url',
    'json_url',
    'not_received_for_publication',
    'pdf_url',
    'publication_date',
    'signing_date',
    'start_page',
    'subtype',
    'title',
    'type',
  ];

  for (const fieldName of fieldNames) {
    url.searchParams.append('fields[]', fieldName);
  }

  return url.toString();
};

const PRESIDENTIAL_TERMS = [
  { name: 'Franklin D. Roosevelt', start: '1933-03-04', end: '1945-04-12' },
  { name: 'Harry S. Truman', start: '1945-04-12', end: '1953-01-20' },
  { name: 'Dwight D. Eisenhower', start: '1953-01-20', end: '1961-01-20' },
  { name: 'John F. Kennedy', start: '1961-01-20', end: '1963-11-22' },
  { name: 'Lyndon B. Johnson', start: '1963-11-22', end: '1969-01-20' },
  { name: 'Richard Nixon', start: '1969-01-20', end: '1974-08-09' },
  { name: 'Gerald R. Ford', start: '1974-08-09', end: '1977-01-20' },
  { name: 'Jimmy Carter', start: '1977-01-20', end: '1981-01-20' },
  { name: 'Ronald Reagan', start: '1981-01-20', end: '1989-01-20' },
  { name: 'George H.W. Bush', start: '1989-01-20', end: '1993-01-20' },
  { name: 'William J. Clinton', start: '1993-01-20', end: '2001-01-20' },
  { name: 'George W. Bush', start: '2001-01-20', end: '2009-01-20' },
  { name: 'Barack Obama', start: '2009-01-20', end: '2017-01-20' },
  { name: 'Donald J. Trump', start: '2017-01-20', end: '2021-01-20' },
  { name: 'Joseph R. Biden, Jr.', start: '2021-01-20', end: '2025-01-20' },
  { name: 'Donald J. Trump', start: '2025-01-20', end: '9999-12-31' },
];

const parseIsoDate = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const derivePresidentFromDate = (dateString) => {
  const date = parseIsoDate(dateString);
  if (!date) {
    return null;
  }

  return (
    PRESIDENTIAL_TERMS.find((term) => {
      const start = new Date(term.start);
      const end = new Date(term.end);
      return date >= start && date < end;
    })?.name ?? null
  );
};

const normalizeRecord = (record) => {
  const normalized = FIELDS.reduce((acc, field) => {
    acc[field] = record[field] ?? null;
    return acc;
  }, {});

  const apiPresident = record.president ?? null;
  const dateForPresident = record.signing_date || record.publication_date || null;
  const derivedPresident = apiPresident ? null : derivePresidentFromDate(dateForPresident);

  normalized.president = apiPresident || derivedPresident || null;
  normalized.president_source = apiPresident ? 'api' : derivedPresident ? 'derived_from_date' : 'unknown';
  normalized.pdf_available = Boolean(record.pdf_url);

  const dateForYear = record.signing_date || record.publication_date || '';
  normalized.year = dateForYear.slice(0, 4).match(/^\d{4}$/)
    ? Number(dateForYear.slice(0, 4))
    : null;

  return normalized;
};

const compareDatesDesc = (a, b) => {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
};

const validateResponse = async (response, url) => {
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    const body = await response.text();
    const snippet = body.slice(0, 300);
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}\nResponse body:\n${snippet}`
    );
  }

  if (!contentType.toLowerCase().includes('application/json')) {
    const body = await response.text();
    const snippet = body.slice(0, 300);
    throw new Error(
      `Expected JSON response from ${url} but got ${contentType}. Response body:\n${snippet}`
    );
  }
};

const main = async () => {
  const records = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = buildUrl(page);
    console.log(`Fetching page ${page}: ${url}`);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'executive-orders-dashboard/0.1',
      },
    });

    await validateResponse(response, url);
    const data = await response.json();

    if (!Array.isArray(data.results)) {
      throw new Error('Unexpected API response: missing results array');
    }

    console.log(`Fetched ${data.results.length} records from page ${page}`);
    records.push(...data.results.map(normalizeRecord));

    totalPages = Number(data.total_pages) || page;
    page += 1;
  }

  records.sort((a, b) => {
    const signingDateComparison = compareDatesDesc(a.signing_date, b.signing_date);
    if (signingDateComparison !== 0) {
      return signingDateComparison;
    }
    return compareDatesDesc(a.publication_date, b.publication_date);
  });

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(records, null, 2) + '\n', 'utf-8');

  console.log(`Saved ${records.length} executive orders to ${OUTPUT_FILE}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
