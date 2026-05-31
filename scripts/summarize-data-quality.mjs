import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const metadataPath = path.join(__dirname, '../public/data/executive-orders.json');
const fullTextPath = path.join(__dirname, '../public/data/executive-orders-full-text.json');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const isMissing = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const metadata = readJson(metadataPath);
const fullText = readJson(fullTextPath);

const countStatus = fullText.reduce(
  (counts, record) => {
    const status = record.full_text_status;
    if (status === 'fetched') counts.fetched += 1;
    else if (status === 'missing_source') counts.missing_source += 1;
    else if (status === 'error') counts.error += 1;
    else counts.other += 1;
    return counts;
  },
  { fetched: 0, missing_source: 0, error: 0, other: 0 }
);

const missingFieldCounts = metadata.reduce(
  (counts, record) => {
    if (isMissing(record.executive_order_number)) counts.executive_order_number += 1;
    if (isMissing(record.document_number)) counts.document_number += 1;
    if (isMissing(record.title)) counts.title += 1;
    if (isMissing(record.president)) counts.president += 1;
    if (isMissing(record.signing_date)) counts.signing_date += 1;
    if (isMissing(record.publication_date)) counts.publication_date += 1;
    return counts;
  },
  {
    executive_order_number: 0,
    document_number: 0,
    title: 0,
    president: 0,
    signing_date: 0,
    publication_date: 0,
  }
);

const sourceLinkCounts = metadata.reduce(
  (counts, record) => {
    if (!isMissing(record.full_text_xml_url)) counts.full_text_xml_url += 1;
    if (!isMissing(record.json_url)) counts.json_url += 1;
    if (!isMissing(record.html_url)) counts.html_url += 1;
    if (!isMissing(record.pdf_url)) counts.pdf_url += 1;
    return counts;
  },
  {
    full_text_xml_url: 0,
    json_url: 0,
    html_url: 0,
    pdf_url: 0,
  }
);

const fetchedButNoExecNum = fullText.filter(
  (record) => record.full_text_status === 'fetched' && isMissing(record.executive_order_number)
).length;

const missingExecNumRecords = fullText
  .filter((record) => isMissing(record.executive_order_number))
  .slice(0, 25)
  .map((record) => {
    const sourceUrls = ['full_text_xml_url', 'json_url', 'html_url', 'pdf_url'];
    const available = sourceUrls.some((key) => !isMissing(record[key]));
    return {
      document_number: record.document_number ?? null,
      title: record.title ?? null,
      president: record.president ?? null,
      signing_date: record.signing_date ?? null,
      publication_date: record.publication_date ?? null,
      full_text_status: record.full_text_status ?? null,
      full_text_source: record.full_text_source ?? null,
      source_urls_available: available ? 'yes' : 'no',
    };
  });

const printSection = (title) => {
  console.log(`\n=== ${title} ===`);
};

console.log('Executive Orders Dashboard Data Quality Summary');
console.log('Generated:', new Date().toISOString());

printSection('1. Totals');
console.log('Total metadata records:', metadata.length);
console.log('Total enriched full-text records:', fullText.length);

printSection('2. full_text_status counts');
console.log('fetched:', countStatus.fetched);
console.log('missing_source:', countStatus.missing_source);
console.log('error:', countStatus.error);
console.log('other / null / undefined / unexpected:', countStatus.other);

printSection('3. Metadata missing field counts');
console.log('executive_order_number missing/null/blank:', missingFieldCounts.executive_order_number);
console.log('document_number missing/null/blank:', missingFieldCounts.document_number);
console.log('title missing/null/blank:', missingFieldCounts.title);
console.log('president missing/null/blank:', missingFieldCounts.president);
console.log('signing_date missing/null/blank:', missingFieldCounts.signing_date);
console.log('publication_date missing/null/blank:', missingFieldCounts.publication_date);

printSection('4. Source link counts in metadata');
console.log('full_text_xml_url present:', sourceLinkCounts.full_text_xml_url);
console.log('json_url present:', sourceLinkCounts.json_url);
console.log('html_url present:', sourceLinkCounts.html_url);
console.log('pdf_url present:', sourceLinkCounts.pdf_url);

printSection('5. Records with fetched status but no executive_order_number');
console.log(fetchedButNoExecNum);

printSection('6. First 25 records missing executive_order_number');
missingExecNumRecords.forEach((record, index) => {
  console.log(`\nRecord ${index + 1}:`);
  console.log('  document_number:', record.document_number);
  console.log('  title:', record.title);
  console.log('  president:', record.president);
  console.log('  signing_date:', record.signing_date);
  console.log('  publication_date:', record.publication_date);
  console.log('  full_text_status:', record.full_text_status);
  console.log('  full_text_source:', record.full_text_source);
  console.log('  source URLs available:', record.source_urls_available);
});

printSection('7. Summary guidance');
const summaryLines = [];
summaryLines.push(`The dataset contains ${metadata.length} metadata records and ${fullText.length} enriched full-text records.`);
summaryLines.push(`Full-text status is dominated by ${countStatus.fetched} fetched records and ${countStatus.missing_source} missing_source records.`);
if (countStatus.error > 0) summaryLines.push(`There are ${countStatus.error} records with error status that should be disclosed.`);
if (countStatus.other > 0) summaryLines.push(`There are ${countStatus.other} records with unexpected or missing full_text_status values that should be investigated.`);
if (missingFieldCounts.executive_order_number > 0) summaryLines.push(`There are ${missingFieldCounts.executive_order_number} metadata records without an executive_order_number, which may affect display, filtering, or linking.`);
if (missingFieldCounts.title > 0) summaryLines.push(`There are ${missingFieldCounts.title} records missing titles; these should be flagged since title is a primary display field.`);
if (missingFieldCounts.president > 0) summaryLines.push(`There are ${missingFieldCounts.president} records missing president information; consider disclosing incomplete president attribution.`);
if (missingFieldCounts.signing_date > 0 || missingFieldCounts.publication_date > 0) {
  summaryLines.push(`Date coverage is incomplete: ${missingFieldCounts.signing_date} missing signing dates and ${missingFieldCounts.publication_date} missing publication dates.`);
}
if (sourceLinkCounts.full_text_xml_url < metadata.length || sourceLinkCounts.json_url < metadata.length || sourceLinkCounts.html_url < metadata.length || sourceLinkCounts.pdf_url < metadata.length) {
  summaryLines.push('Source link availability varies across records; the dashboard should make it clear that not all records include XML, JSON, HTML, or PDF sources.');
}
if (fetchedButNoExecNum > 0) {
  summaryLines.push('Some fetched full-text records lack executive_order_number, which may impact search and matching behavior.');
}
if (summaryLines.length === 0) summaryLines.push('The dataset appears complete with no obvious quality issues detected.');
summaryLines.forEach((line) => console.log('- ' + line));
