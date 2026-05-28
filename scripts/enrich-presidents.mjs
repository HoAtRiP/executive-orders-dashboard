import fs from 'fs/promises';
import path from 'path';

const DATA_FILE = path.resolve('public', 'data', 'executive-orders.json');

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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const derivePresidentFromDate = (dateString) => {
  const date = parseIsoDate(dateString);
  if (!date) {
    return null;
  }

  const term = PRESIDENTIAL_TERMS.find((termRange) => {
    const start = new Date(termRange.start);
    const end = new Date(termRange.end);
    return date >= start && date < end;
  });

  return term ? term.name : null;
};

const enrichRecord = (record) => {
  const existingPresident = record.president ?? null;
  const dateForPresident = record.signing_date || record.publication_date || null;
  const derivedPresident = existingPresident ? existingPresident : derivePresidentFromDate(dateForPresident);

  const presidentSource = existingPresident
    ? 'api'
    : derivedPresident
    ? 'derived_from_date'
    : 'unknown';

  return {
    ...record,
    president: existingPresident || derivedPresident || null,
    president_source: presidentSource,
  };
};

const main = async () => {
  const text = await fs.readFile(DATA_FILE, 'utf-8');
  const records = JSON.parse(text);

  let updatedCount = 0;
  let unknownCount = 0;

  const enrichedRecords = records.map((record) => {
    const enriched = enrichRecord(record);

    if (enriched.president_source !== 'api') {
      updatedCount += 1;
    }
    if (enriched.president_source === 'unknown') {
      unknownCount += 1;
    }

    return enriched;
  });

  await fs.writeFile(DATA_FILE, JSON.stringify(enrichedRecords, null, 2) + '\n', 'utf-8');

  console.log(`Updated ${updatedCount} records with derived or missing president values.`);
  console.log(`Records remaining unknown: ${unknownCount}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
