import type { ExecutiveOrder } from './types';

export type EoNumberStatus = 'known' | 'unknown';
export type FullTextStatus = 'available' | 'missing_source' | 'error' | 'not_fetched' | 'unknown';

export interface RecordDataQuality {
  eoNumberStatus: EoNumberStatus;
  fullTextStatus: FullTextStatus;
  sourceAvailability: {
    hasFullTextXml: boolean;
    hasJson: boolean;
    hasHtml: boolean;
    hasPdf: boolean;
  };
  displayIdentifier: string;
  badges: string[];
  disclosureNote: string;
}

export type ExecutiveOrderRecord = Partial<ExecutiveOrder> & {
  full_text_status?: string | null;
  full_text_source?: string | null;
  full_text_plain?: string | null;
};

const isMissingValue = (value: unknown): boolean => {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
};

const normalizeFullTextStatus = (status: string | null | undefined): FullTextStatus => {
  if (!status || typeof status !== 'string') {
    return 'unknown';
  }

  const normalized = status.trim().toLowerCase();
  if (normalized === 'fetched') return 'available';
  if (normalized === 'missing_source') return 'missing_source';
  if (normalized === 'error') return 'error';
  if (normalized === 'not_fetched' || normalized === 'not-fetched') return 'not_fetched';
  return 'unknown';
};

export const getRecordDataQuality = (record: ExecutiveOrderRecord): RecordDataQuality => {
  const hasFullTextXml = !isMissingValue(record.full_text_xml_url);
  const hasJson = !isMissingValue(record.json_url);
  const hasHtml = !isMissingValue(record.html_url);
  const hasPdf = !isMissingValue(record.pdf_url);

  const eoNumberStatus: EoNumberStatus = isMissingValue(record.executive_order_number) ? 'unknown' : 'known';
  const fullTextStatus = normalizeFullTextStatus(record.full_text_status);

  const displayIdentifier = !isMissingValue(record.executive_order_number)
    ? String(record.executive_order_number).trim()
    : !isMissingValue(record.document_number)
    ? `Unknown EO Number / Document ${String(record.document_number).trim()}`
    : 'Unknown EO Number';

  const badges: string[] = [];

  if (eoNumberStatus === 'unknown') {
    badges.push('Unknown EO Number');
  }

  if (fullTextStatus === 'available') {
    badges.push('Full Text Available');
  } else if (fullTextStatus === 'missing_source') {
    badges.push('Missing Source');
  } else if (fullTextStatus === 'error') {
    badges.push('Error');
  } else if (fullTextStatus === 'not_fetched') {
    badges.push('Not Fetched');
  } else {
    badges.push('Unknown Full Text Status');
  }

  if (hasPdf) {
    badges.push('PDF Available');
  }

  if (!hasFullTextXml && !hasJson && !hasHtml && !hasPdf) {
    badges.push('Metadata Only');
  }

  const disclosureNoteParts: string[] = [];

  if (fullTextStatus === 'available') {
    disclosureNoteParts.push('Full text is available and may be searchable.');
  } else if (fullTextStatus === 'missing_source') {
    disclosureNoteParts.push('This record is metadata-only because no XML/JSON/HTML source link is available.');
  } else if (fullTextStatus === 'error') {
    disclosureNoteParts.push('There was an error fetching full text for this record.');
  } else if (fullTextStatus === 'not_fetched') {
    disclosureNoteParts.push('This record has not been fetched for full text yet.');
  } else {
    disclosureNoteParts.push('Full text availability is unknown for this record.');
  }

  if (eoNumberStatus === 'unknown') {
    if (!isMissingValue(record.document_number)) {
      disclosureNoteParts.push('This record lacks a clean executive order number; document_number is used as a fallback.');
    } else {
      disclosureNoteParts.push('This record lacks a clean executive order number and no document_number fallback is available.');
    }
  }

  return {
    eoNumberStatus,
    fullTextStatus,
    sourceAvailability: {
      hasFullTextXml,
      hasJson,
      hasHtml,
      hasPdf,
    },
    displayIdentifier,
    badges,
    disclosureNote: disclosureNoteParts.join(' '),
  };
};
