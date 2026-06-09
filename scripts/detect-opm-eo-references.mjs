import fs from 'fs/promises';

const INPUT_FILE = new URL('../public/data/opm-chcoc-text-sample.json', import.meta.url);
const OUTPUT_FILE = new URL('../public/data/opm-chcoc-eo-reference-sample.json', import.meta.url);
const DEFAULT_SAMPLE_SIZE = 10;

const parseSampleSize = (value) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_SIZE;
};

const normalizeText = (value) => {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const titlePhrasePatterns = [
  /\b(?:entitled|titled|named)\s+["“]([^"”\n]{1,200}?)["”]/gi,
  /\b(?:entitled|titled|named)\s+([^.;:\n"“”]{1,200}?)(?=(?:\s+and\s+(?:entitled|titled|named)\b|[.;:\n]|\s+\(EO\b|\s+\(E\.O\.\b|\s+Executive Order\b|\s+Executive Orders\b|\s+EO\b|\s+E\.O\.\b|\s+No\.\b|\s+\d{4,5}\b))/gi,
];

const eoNumberPatterns = [
  /\bExecutive Orders?\s+(?:No\.\s*)?(\d{4,5})(?:\s*(?:,|and|&)\s*(\d{4,5}))?/gi,
  /\bE\.O\.\s*(?:No\.\s*)?(\d{4,5})(?:\s*(?:,|and|&)\s*(\d{4,5}))?/gi,
  /\bEO\s*(?:No\.\s*)?(\d{4,5})(?:\s*(?:,|and|&)\s*(\d{4,5}))?/gi,
  /\bExecutive Order\s*(?:No\.\s*)?(\d{4,5})(?:\s*(?:,|and|&)\s*(\d{4,5}))?/gi,
];

const detectEoNumbers = (text) => {
  const numbers = [];

  for (const pattern of eoNumberPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      numbers.push(match[1]);
      if (match[2]) {
        numbers.push(match[2]);
      }
    }
  }

  return unique(numbers);
};

const detectEoTitlePhrases = (text) => {
  const phrases = [];

  for (const pattern of titlePhrasePatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const phrase = normalizeText(match[1]);
      if (phrase) {
        phrases.push(phrase);
      }
    }
  }

  return unique(phrases);
};

const annotateRecord = (record) => {
  const extractedText = normalizeText(record.extracted_text);
  const detectedEoNumbers = detectEoNumbers(extractedText);
  const detectedEoTitlePhrases = detectEoTitlePhrases(extractedText);

  return {
    ...record,
    detected_eo_numbers: detectedEoNumbers,
    detected_eo_title_phrases: detectedEoTitlePhrases,
    eo_reference_count: detectedEoNumbers.length,
  };
};

async function main() {
  const sampleSize = parseSampleSize(process.argv[2]);

  console.log(`Input file: ${INPUT_FILE.pathname}`);
  console.log(`Sample size: ${sampleSize}`);

  const raw = await fs.readFile(INPUT_FILE, 'utf8');
  const records = JSON.parse(raw);
  const sampleRecords = records.slice(0, sampleSize);

  const output = sampleRecords.map(annotateRecord);
  const recordsWithEoReferences = output.filter((record) => record.eo_reference_count > 0).length;
  const totalEoReferences = output.reduce((sum, record) => sum + record.eo_reference_count, 0);

  const eoNumberCounts = new Map();
  for (const record of output) {
    for (const eoNumber of record.detected_eo_numbers) {
      eoNumberCounts.set(eoNumber, (eoNumberCounts.get(eoNumber) ?? 0) + 1);
    }
  }

  const topDetectedEoNumbers = [...eoNumberCounts.entries()]
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .slice(0, 10)
    .map(([eoNumber, count]) => `${eoNumber} (${count})`);

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`Records processed: ${output.length}`);
  console.log(`Records with EO references: ${recordsWithEoReferences}`);
  console.log(`Total EO references detected: ${totalEoReferences}`);
  console.log(`Top detected EO numbers: ${topDetectedEoNumbers.length ? topDetectedEoNumbers.join(', ') : 'none'}`);
  console.log(`Output file path: ${OUTPUT_FILE.pathname}`);
}

main().catch((error) => {
  console.error('EO reference detection failed:', error);
  process.exit(1);
});