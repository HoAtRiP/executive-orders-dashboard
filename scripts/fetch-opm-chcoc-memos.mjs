import fs from 'fs/promises';
import path from 'path';

const SOURCE_URL = 'https://www.opm.gov/chcoc/published-memos/';
const OUTPUT_FILE = path.resolve('public', 'data', 'opm-chcoc-raw.json');

const cleanHtmlEntities = (value) => {
  if (!value) return value;
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

const stripHtml = (value) => {
  if (!value) return '';
  const cleaned = cleanHtmlEntities(value);
  return cleaned.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
};

const resolveUrl = (href, base) => {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
};

const getSourceLinkType = (pdfUrl) => {
  if (!pdfUrl) {
    return 'unknown';
  }

  const normalizedUrl = pdfUrl.toLowerCase();
  if (normalizedUrl.endsWith('.pdf')) {
    return 'pdf';
  }

  if (normalizedUrl.includes('opm.gov')) {
    return 'webpage';
  }

  return 'unknown';
};

const parseTableRows = (html) => {
  const tableMatch = html.match(/<table[^>]+id=["']transmittalsTable["'][\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  const tbody = tableMatch?.[1] ?? '';
  if (!tbody) {
    throw new Error('Unable to find memo table in HTML');
  }

  const rowMatches = [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rowMatches.map((match) => match[1].trim()).filter((rowHtml) => rowHtml.length > 0);
};

const parseRow = (rowHtml) => {
  const anchorMatches = [...rowHtml.matchAll(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)];
  if (anchorMatches.length === 0) {
    return null;
  }

  const [firstAnchor, ...otherAnchors] = anchorMatches;
  const pdfUrl = resolveUrl(firstAnchor[2], SOURCE_URL);
  const title = stripHtml(firstAnchor[3]);
  const attachments = otherAnchors.map((match) => ({
    title: stripHtml(match[3]),
    url: resolveUrl(match[2], SOURCE_URL),
  }));

  const tdMatches = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
  const [date, from, referenceId, stakeholders, yearText] = tdMatches;

  return {
    title: title || null,
    date: date || null,
    from: from || null,
    reference_id: referenceId || null,
    stakeholders: stakeholders || null,
    year: yearText && /^\d{4}$/.test(yearText.trim()) ? Number(yearText.trim()) : null,
    source_url: SOURCE_URL,
    pdf_url: pdfUrl || null,
    source_link_type: getSourceLinkType(pdfUrl),
    attachments: attachments.length > 0 ? attachments : [],
  };
};

const printSampleRecords = (heading, records, max, formatter) => {
  const sample = records.slice(0, max);
  if (!sample.length) {
    console.log(`${heading}: none found`);
    return;
  }

  console.log(`\n${heading} (showing ${sample.length} of ${records.length}):`);
  sample.forEach((record, index) => {
    console.log(`\n${index + 1}. title: ${record.title ?? '<missing>'}`);
    console.log(`   date: ${record.date ?? '<missing>'}`);
    console.log(`   year: ${record.year ?? '<missing>'}`);
    console.log(`   pdf_url: ${record.pdf_url ?? '<missing>'}`);
    formatter(record);
  });
};

const main = async () => {
  console.log(`Fetching source URL: ${SOURCE_URL}`);

  const response = await fetch(SOURCE_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'executive-orders-dashboard/0.1',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch ${SOURCE_URL}: ${response.status} ${response.statusText}\n${text.slice(0, 300)}`);
  }

  const html = await response.text();
  const rows = parseTableRows(html);
  const records = rows.map(parseRow).filter(Boolean);

  const totalRecords = records.length;
  const recordsWithPdf = records.filter((record) => Boolean(record.pdf_url)).length;
  const recordsWithoutPdf = totalRecords - recordsWithPdf;
  const recordsWithPdfSource = records.filter((record) => record.source_link_type === 'pdf').length;
  const recordsWithWebpageSource = records.filter((record) => record.source_link_type === 'webpage').length;
  const recordsWithUnknownSource = records.filter((record) => record.source_link_type === 'unknown').length;
  const recordsWithAttachments = records.filter((record) => Array.isArray(record.attachments) && record.attachments.length > 0).length;
  const totalAttachmentCount = records.reduce(
    (sum, record) => sum + (Array.isArray(record.attachments) ? record.attachments.length : 0),
    0
  );
  const missingTitle = records.filter((record) => !record.title).length;
  const missingDate = records.filter((record) => !record.date).length;
  const missingFrom = records.filter((record) => !record.from).length;
  const missingStakeholders = records.filter((record) => !record.stakeholders).length;

  const titleDateMap = records.reduce((acc, record) => {
    const key = `${record.title || ''}||${record.date || ''}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const duplicateTitleDateCount = Object.values(titleDateMap).filter((count) => count > 1).length;

  console.log(`Extracted ${totalRecords} memo records`);
  console.log(`Records with pdf_url: ${recordsWithPdf}`);
  console.log(`Records without pdf_url: ${recordsWithoutPdf}`);
  console.log(`Records with source_link_type \"pdf\": ${recordsWithPdfSource}`);
  console.log(`Records with source_link_type \"webpage\": ${recordsWithWebpageSource}`);
  console.log(`Records with source_link_type \"unknown\": ${recordsWithUnknownSource}`);
  console.log(`Records with attachments: ${recordsWithAttachments}`);
  console.log(`Total attachment count: ${totalAttachmentCount}`);
  console.log(`Records missing title: ${missingTitle}`);
  console.log(`Records missing date: ${missingDate}`);
  console.log(`Records missing from: ${missingFrom}`);
  console.log(`Records missing stakeholders: ${missingStakeholders}`);
  console.log(`Duplicate title/date combinations: ${duplicateTitleDateCount}`);

  const recordsWithAttachmentSamples = records.filter((record) => Array.isArray(record.attachments) && record.attachments.length > 0);
  printSampleRecords('First 5 records with attachments', recordsWithAttachmentSamples, 5, (record) => {
    record.attachments.forEach((attachment, attachmentIndex) => {
      console.log(`   attachment ${attachmentIndex + 1}: ${attachment.title ?? '<missing>'}`);
      console.log(`      url: ${attachment.url ?? '<missing>'}`);
    });
  });

  const missingStakeholdersSamples = records.filter((record) => !record.stakeholders);
  printSampleRecords('First 10 records missing stakeholders', missingStakeholdersSamples, 10, () => {});

  const nonPdfUrlSamples = records.filter((record) => {
    if (!record.pdf_url) return true;
    return !record.pdf_url.toLowerCase().endsWith('.pdf');
  });
  printSampleRecords('First 10 records where pdf_url does not end in .pdf', nonPdfUrlSamples, 10, () => {});

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(records, null, 2) + '\n', 'utf-8');

  console.log(`Wrote output to ${OUTPUT_FILE}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
