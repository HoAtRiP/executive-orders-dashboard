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

const eoNumberPattern = /\b(?:E\.?\s*O\.?|Executive\s+Order)\s*(?:No\.?\s*)?(\d{1,5})\b/i;
const anyEoPattern = /\b(?:E\.?\s*O\.?|Executive\s+Order)(?:\s+No\.?\s*)?\d{1,5}\b/i;

const detectEoNumber = (text) => {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const match = text.match(eoNumberPattern);
  return match ? match[0].trim() : null;
};

const records = fullText
  .map((record, index) => ({ record, index }))
  .filter(({ record }) => isMissing(record.executive_order_number));

console.log('Diagnose Unknown EO Numbers');
console.log('Generated:', new Date().toISOString());
console.log('Total records with missing executive_order_number:', records.length);

const detectionSummary = {
  title: 0,
  citation: 0,
  full_text_plain: 0,
  disposition_notes: 0,
  any: 0,
};

records.forEach(({ record, index }, recordIndex) => {
  const titleMatch = detectEoNumber(record.title);
  const citationMatch = detectEoNumber(record.citation);
  const fullTextMatch = detectEoNumber(record.full_text_plain);
  const dispositionMatch = detectEoNumber(record.disposition_notes);
  const anyMatch = titleMatch || citationMatch || fullTextMatch || dispositionMatch || null;

  if (titleMatch) detectionSummary.title += 1;
  if (citationMatch) detectionSummary.citation += 1;
  if (fullTextMatch) detectionSummary.full_text_plain += 1;
  if (dispositionMatch) detectionSummary.disposition_notes += 1;
  if (anyMatch) detectionSummary.any += 1;

  const first500 = typeof record.full_text_plain === 'string'
    ? record.full_text_plain.slice(0, 500).replace(/\s+/g, ' ').trim()
    : 'N/A';

  const urlExists = (key) => !isMissing(record[key]);

  console.log(`\n--- Record ${recordIndex + 1} of ${records.length} ---`);
  console.log('index in executive-orders-full-text.json:', index);
  console.log('document_number:', record.document_number ?? 'N/A');
  console.log('title:', record.title ?? 'N/A');
  console.log('president:', record.president ?? 'N/A');
  console.log('signing_date:', record.signing_date ?? 'N/A');
  console.log('publication_date:', record.publication_date ?? 'N/A');
  console.log('citation:', record.citation ?? 'N/A');
  console.log('full_text_status:', record.full_text_status ?? 'N/A');
  console.log('full_text_source:', record.full_text_source ?? 'N/A');
  console.log('html_url exists:', urlExists('html_url') ? 'yes' : 'no');
  console.log('json_url exists:', urlExists('json_url') ? 'yes' : 'no');
  console.log('full_text_xml_url exists:', urlExists('full_text_xml_url') ? 'yes' : 'no');
  console.log('pdf_url exists:', urlExists('pdf_url') ? 'yes' : 'no');
  console.log('first 500 chars of full_text_plain:');
  console.log(first500 || 'N/A');
  console.log('EO number detected in title:', titleMatch ?? 'none');
  console.log('EO number detected in citation:', citationMatch ?? 'none');
  console.log('EO number detected in full_text_plain:', fullTextMatch ?? 'none');
  console.log('EO number detected in disposition_notes:', dispositionMatch ?? 'none');
  console.log('EO number detected in any field:', anyMatch ?? 'none');
});

console.log('\n=== Detection Summary ===');
console.log('Records with EO pattern in title:', detectionSummary.title);
console.log('Records with EO pattern in citation:', detectionSummary.citation);
console.log('Records with EO pattern in full_text_plain:', detectionSummary.full_text_plain);
console.log('Records with EO pattern in disposition_notes:', detectionSummary.disposition_notes);
console.log('Records with EO pattern in any field:', detectionSummary.any);

console.log('\n=== Recommendation ===');
if (records.length === 0) {
  console.log('No records are missing executive_order_number. No special labeling needed.');
} else {
  const likelyEos = detectionSummary.any > 0;
  const fallbackDocNums = records.every(({ record }) => !isMissing(record.document_number));
  if (likelyEos) {
    console.log('These records largely appear to be valid executive orders with missing executive_order_number values.');
  } else {
    console.log('These records do not show obvious EO number patterns in title/citation/full text/disposition notes.');
  }
  console.log('Recommendation: label them as "Unknown EO Number" when executive_order_number is missing.');
  if (fallbackDocNums) {
    console.log('Use document_number as the fallback display identifier where executive_order_number is unavailable.');
  } else {
    console.log('Some records also lack document_number, so fallback display handling should support both unknown EO number and missing document number.');
  }
}
