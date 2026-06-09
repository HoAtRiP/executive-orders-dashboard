import fs from 'fs/promises';

const OPM_INPUT_FILE = new URL('../public/data/opm-chcoc-eo-reference-sample.json', import.meta.url);
const EO_INPUT_FILE = new URL('../public/data/executive-orders.json', import.meta.url);
const OUTPUT_FILE = new URL('../public/data/opm-eo-relationship-sample.json', import.meta.url);

const normalizeEoNumber = (value) => String(value ?? '').trim();

const buildExecutiveOrderMap = (records) => {
  const map = new Map();

  for (const record of records) {
    const key = normalizeEoNumber(record.executive_order_number);
    if (key) {
      map.set(key, record);
    }
  }

  return map;
};

const buildRelationshipRecord = (record, eoMap) => {
  const detectedEoNumbers = Array.isArray(record.detected_eo_numbers)
    ? [...new Set(record.detected_eo_numbers.map(normalizeEoNumber).filter(Boolean))]
    : [];

  const matchedEos = [];
  const unmatchedEoNumbers = [];

  for (const eoNumber of detectedEoNumbers) {
    const matched = eoMap.get(eoNumber);
    if (matched) {
      matchedEos.push({
        executive_order_number: matched.executive_order_number ?? null,
        title: matched.title ?? null,
        president: matched.president ?? null,
        signing_date: matched.signing_date ?? null,
        publication_date: matched.publication_date ?? null,
        citation: matched.citation ?? null,
        pdf_url: matched.pdf_url ?? null,
        html_url: matched.html_url ?? null,
      });
    } else {
      unmatchedEoNumbers.push(eoNumber);
    }
  }

  return {
    opm_title: record.title ?? null,
    opm_date: record.date ?? null,
    opm_year: record.year ?? null,
    opm_from: record.from ?? null,
    opm_reference_id: record.reference_id ?? null,
    opm_pdf_url: record.pdf_url ?? null,
    detected_eo_numbers: detectedEoNumbers,
    matched_eos: matchedEos,
    unmatched_eo_numbers: unmatchedEoNumbers,
  };
};

async function main() {
  const [opmRaw, eoRaw] = await Promise.all([
    fs.readFile(OPM_INPUT_FILE, 'utf8'),
    fs.readFile(EO_INPUT_FILE, 'utf8'),
  ]);

  const opmRecords = JSON.parse(opmRaw);
  const executiveOrderRecords = JSON.parse(eoRaw);
  const eoMap = buildExecutiveOrderMap(executiveOrderRecords);

  const sourceRecords = opmRecords.filter((record) => Array.isArray(record.detected_eo_numbers) && record.detected_eo_numbers.length > 0);
  const output = [];
  let totalDetectedEoNumbers = 0;
  let totalMatchedEoNumbers = 0;
  let totalUnmatchedEoNumbers = 0;
  const unmatchedCounts = new Map();

  for (const record of sourceRecords) {
    const relationshipRecord = buildRelationshipRecord(record, eoMap);
    output.push(relationshipRecord);

    totalDetectedEoNumbers += relationshipRecord.detected_eo_numbers.length;
    totalMatchedEoNumbers += relationshipRecord.matched_eos.length;
    totalUnmatchedEoNumbers += relationshipRecord.unmatched_eo_numbers.length;

    for (const eoNumber of relationshipRecord.unmatched_eo_numbers) {
      unmatchedCounts.set(eoNumber, (unmatchedCounts.get(eoNumber) ?? 0) + 1);
    }
  }

  const topUnmatchedEoNumbers = [...unmatchedCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }))
    .slice(0, 10)
    .map(([eoNumber, count]) => `${eoNumber} (${count})`);

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`OPM records processed: ${opmRecords.length}`);
  console.log(`OPM records with EO references: ${sourceRecords.length}`);
  console.log(`Total detected EO numbers: ${totalDetectedEoNumbers}`);
  console.log(`Total matched EO numbers: ${totalMatchedEoNumbers}`);
  console.log(`Total unmatched EO numbers: ${totalUnmatchedEoNumbers}`);
  console.log(`Top unmatched EO numbers: ${topUnmatchedEoNumbers.length ? topUnmatchedEoNumbers.join(', ') : 'none'}`);
  console.log(`Output file path: ${OUTPUT_FILE.pathname}`);
}

main().catch((error) => {
  console.error('OPM/CHCOC EO relationship matching failed:', error);
  process.exit(1);
});