import { useEffect, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import type { ExecutiveOrder } from './types';
import { topics, topicKeywords } from './topicFilters';
import './App.css';

function App() {
  const [orders, setOrders] = useState<ExecutiveOrder[]>([]);
  const [fullTextRecords, setFullTextRecords] = useState<any[]>([]);
  const [activeCoverageFilter, setActiveCoverageFilter] = useState<'all' | 'available' | 'missing_source' | 'unknown_eo'>('all');
  const [search, setSearch] = useState('');
  const [activeTopic, setActiveTopic] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [metaResponse, fullTextResponse] = await Promise.all([
          fetch('/data/executive-orders.json'),
          fetch('/data/executive-orders-full-text.json'),
        ]);

        if (!metaResponse.ok) {
          throw new Error(`Failed to load executive order metadata: ${metaResponse.status}`);
        }
        if (!fullTextResponse.ok) {
          throw new Error(`Failed to load full-text coverage data: ${fullTextResponse.status}`);
        }

        const metaData = (await metaResponse.json()) as ExecutiveOrder[];
        const fullData = await fullTextResponse.json();

        setOrders(metaData);
        setFullTextRecords(fullData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    setActiveTopic('all');
  }, [search, activeCoverageFilter]);

  useEffect(() => {
    setExpandedRows(new Set());
  }, [search, activeTopic, activeCoverageFilter, currentPage]);

  const normalizeSearchText = (value: string | number | undefined | null) => {
    return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  };

  const isMissingValue = (value: string | number | undefined | null) => {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  };

  const normalizeEoNumber = (value: string | number | undefined | null) => {
    return String(value ?? '').replace(/\D+/g, '').trim();
  };

  const extractExecutiveOrderNumber = (query: string | number | undefined | null) => {
    const normalized = normalizeSearchText(query).replace(/\./g, '').replace(/-/g, ' ');
    const match = normalized.match(/^(?:eo|executive order)?\s*([0-9]+)$/);
    return match ? match[1] : null;
  };

  const parseIsoDate = (value: string | number | undefined | null) => {
    if (value == null || String(value).trim() === '') {
      return null;
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const compareDatesDesc = (a: string | undefined | null, b: string | undefined | null) => {
    const dateA = parseIsoDate(a);
    const dateB = parseIsoDate(b);

    if (dateA === null && dateB === null) {
      return 0;
    }
    if (dateA === null) {
      return 1;
    }
    if (dateB === null) {
      return -1;
    }
    return dateB.getTime() - dateA.getTime();
  };

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      const signingDateComparison = compareDatesDesc(a.signing_date, b.signing_date);
      if (signingDateComparison !== 0) {
        return signingDateComparison;
      }
      const pubDateComparison = compareDatesDesc(a.publication_date, b.publication_date);
      if (pubDateComparison !== 0) {
        return pubDateComparison;
      }

      // Tie-breaker: executive order number (numeric) descending. Non-numeric or missing
      // EO numbers are treated as lower priority (appear later).
      const parseEo = (val: string | number | undefined | null) => {
        if (val == null || String(val).trim() === '') return Number.NEGATIVE_INFINITY;
        const n = Number(String(val).replace(/[^0-9.-]+/g, ''));
        return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
      };

      const numA = parseEo(a.executive_order_number);
      const numB = parseEo(b.executive_order_number);

      if (numA === numB) return 0;
      return numB - numA;
    });
  }, [orders]);

  const fuse = useMemo(() => {
    return new Fuse(sortedOrders, {
      includeScore: true,
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 2,
      keys: [
        { name: 'executive_order_number', weight: 0.35 },
        { name: 'president', weight: 0.25 },
        { name: 'title', weight: 0.25 },
        { name: 'citation', weight: 0.12 },
        { name: 'document_number', weight: 0.12 },
        { name: 'signing_date', weight: 0.05 },
        { name: 'publication_date', weight: 0.05 },
        { name: 'year', weight: 0.05 },
        { name: 'disposition_notes', weight: 0.05 },
        { name: 'start_page', weight: 0.02 },
        { name: 'end_page', weight: 0.02 },
      ],
    });
  }, [sortedOrders]);

  const getOrderKey = (order: ExecutiveOrder) => {
    return `${order.executive_order_number ?? ''}|${order.document_number ?? ''}|${order.signing_date ?? ''}|${order.publication_date ?? ''}`;
  };

  const getCoverageKey = (record: { document_number?: string; executive_order_number?: string; signing_date?: string; publication_date?: string }) => {
    if (record.document_number && String(record.document_number).trim() !== '') {
      return `doc:${String(record.document_number).trim()}`;
    }

    return `eo:${normalizeEoNumber(record.executive_order_number)}|pub:${String(record.publication_date ?? '').trim()}|sign:${String(record.signing_date ?? '').trim()}`;
  };

  const coverageMap = useMemo(() => {
    const map = new Map<string, any>();
    fullTextRecords.forEach((record) => {
      const key = getCoverageKey(record);
      if (key) {
        map.set(key, record);
      }
    });
    return map;
  }, [fullTextRecords]);

  const matchesCoverageFilter = (order: ExecutiveOrder, filter: 'all' | 'available' | 'missing_source' | 'unknown_eo') => {
    if (filter === 'all') return true;

    if (filter === 'unknown_eo') {
      return isMissingValue(order.executive_order_number);
    }

    const key = getCoverageKey(order);
    const coverageRecord = coverageMap.get(key);
    if (!coverageRecord) return false;

    if (filter === 'available') {
      return coverageRecord.full_text_status === 'fetched';
    }
    if (filter === 'missing_source') {
      return coverageRecord.full_text_status === 'missing_source';
    }
    return false;
  };

  const addUniqueOrders = (target: ExecutiveOrder[], source: ExecutiveOrder[], seen: Set<string>) => {
    source.forEach((order) => {
      const key = getOrderKey(order);
      if (!seen.has(key)) {
        seen.add(key);
        target.push(order);
      }
    });
  };

  const formatNumber = (value: number) => value.toLocaleString('en-US');

  const coverageSummary = useMemo(() => {
    const totalRecords = orders.length;
    const fullTextAvailable = fullTextRecords.filter((record) => record.full_text_status === 'fetched').length;
    const missingSource = fullTextRecords.filter((record) => record.full_text_status === 'missing_source').length;
    const unknownEoCount = orders.filter((order) => isMissingValue(order.executive_order_number)).length;

    return {
      totalRecords,
      fullTextAvailable,
      missingSource,
      unknownEoCount,
      formatNumber,
    };
  }, [orders, fullTextRecords]);

  const getOrderFullTextPlain = (order: ExecutiveOrder) => {
    const coverageRecord = coverageMap.get(getCoverageKey(order));
    if (!coverageRecord || !coverageRecord.full_text_plain) return '';
    return String(coverageRecord.full_text_plain);
  };

  // This is a direct extracted text preview from available full text, not an AI-generated summary.
  const getTextPreview = (order: ExecutiveOrder) => {
    const rawFullText = getOrderFullTextPlain(order).trim();
    if (!rawFullText) {
      return 'Text preview unavailable; full text is not available in this dashboard.';
    }

    const fullText = rawFullText.replace(/\r/g, '');
    const normalizedTitle = normalizeSearchText(order.title ?? '');

    const splitParagraphs = fullText
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    const extractSentences = (text: string): string[] => {
      const matches = text.match(/[^.!?]+[.!?]+[\])'"`’”]*|[^.!?]+$/g);
      return matches ? matches.map((sentence) => sentence.trim()).filter(Boolean) : [];
    };

    const isCitationFragment = (sentence: string) => {
      const normalized = normalizeSearchText(sentence);
      const citationPatterns = /(?:u\.s\.c\.|c\.f\.r\.|et seq\.|e\.o\.|\bsec\.?\b|\bsection\s+\d+\b|\bpub\. l\.\b|\bstat\.\b)/i;
      if (normalized.length < 40 && citationPatterns.test(sentence)) return true;
      if (/^[A-Z0-9 .,()\-]+$/.test(sentence) && citationPatterns.test(sentence) && normalized.length < 80) return true;
      return false;
    };

    const isHeaderParagraph = (paragraph: string) => {
      const trimmed = paragraph.trim();
      const normalized = normalizeSearchText(trimmed);
      if (/^title\s+\d+\s*[-–—]\s*the president\b/i.test(trimmed)) return true;
      if (/^executive order\s*\d{1,5}.*\bof\b/i.test(trimmed)) return true;
      if (normalizedTitle && normalized === normalizedTitle) return true;
      if (normalizedTitle && normalized.includes(normalizedTitle) && trimmed.split(/\s+/).length <= 20) return true;
      return false;
    };

    const chooseParagraph = () => {
      const sectionParagraph = splitParagraphs.find((paragraph) => /section\s*1\b.*policy/i.test(paragraph));
      if (sectionParagraph && !isCitationFragment(sectionParagraph)) return sectionParagraph;

      const authorityParagraph = splitParagraphs.find((paragraph) => /by the authority vested in me/i.test(paragraph));
      if (authorityParagraph && !isCitationFragment(authorityParagraph)) return authorityParagraph;

      return splitParagraphs.find((paragraph) => !isHeaderParagraph(paragraph) && !isCitationFragment(paragraph)) || null;
    };

    const paragraph = chooseParagraph();
    if (!paragraph) {
      return 'Text preview unavailable from extracted text.';
    }

    const sentences = extractSentences(paragraph).filter((sentence) => !isCitationFragment(sentence));
    const usefulSentences: string[] = [];

    for (const sentence of sentences) {
      if (!sentence) continue;
      if (usefulSentences.length === 0 && isHeaderParagraph(sentence)) {
        continue;
      }
      usefulSentences.push(sentence);
      if (usefulSentences.length >= 3) break;
    }

    if (usefulSentences.length === 0) {
      return 'Text preview unavailable from extracted text.';
    }

    return usefulSentences.join(' ');
  };

  // Phase 1 topic filtering uses curated keyword matching rather than AI semantic classification.
  const matchesTopic = (order: ExecutiveOrder, topic: string) => {
    if (topic === 'all') return true;
    const keywords = topicKeywords[topic];
    if (!keywords) return true;

    const textValues = [
      order.executive_order_number,
      order.title,
      order.president,
      order.citation,
      order.document_number,
      order.disposition_notes,
      order.signing_date,
      order.publication_date,
      order.year,
      getOrderFullTextPlain(order),
    ]
      .filter((value): value is string | number => value !== undefined && value !== null)
      .join(' ');

    const normalizedText = normalizeSearchText(textValues);
    return keywords.some((keyword) => normalizedText.includes(normalizeSearchText(keyword)));
  };

  const rankedOrders = useMemo(() => {
    const searchText = normalizeSearchText(search);
    const filteredOrders = sortedOrders.filter((order) => matchesCoverageFilter(order, activeCoverageFilter));
    if (!searchText) {
      return filteredOrders;
    }

    const hasPdf = (order: ExecutiveOrder) => Boolean(order.pdf_url);
    const isPdfAvailableSearch = searchText === 'pdf' || searchText === 'available' || searchText === 'pdf available';
    const isPdfUnavailableSearch = searchText === 'no pdf' || searchText === 'unavailable' || searchText === 'pdf unavailable';

    if (isPdfAvailableSearch) {
      return filteredOrders.filter(hasPdf);
    }

    if (isPdfUnavailableSearch) {
      return filteredOrders.filter((order) => !hasPdf(order));
    }

    const searchEoNumber = extractExecutiveOrderNumber(searchText);
    const normalizedValue = (value: string | number | undefined | null) => normalizeSearchText(value);
    const exactMatch = (value: string | number | undefined | null) => normalizedValue(value) === searchText;
    const startsWith = (value: string | number | undefined | null) => normalizedValue(value).startsWith(searchText);

    const acronymAliases: Record<string, string[]> = {
      fema: ['fema', 'federal emergency management agency', 'emergency management', 'disaster', 'stafford act'],
    };
    const knownAcronyms = new Set(['fema', 'omb', 'opm', 'dhs', 'doj', 'cisa', 'hhs', 'dod', 'dos']);
    const isShortAcronymQuery = (raw: string) => {
      const normalizedRaw = String(raw ?? '').trim();
      return knownAcronyms.has(normalizedRaw.toLowerCase()) && /^[A-Za-z]{2,4}$/.test(normalizedRaw);
    };
    const escapeRegExp = (value: string) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const acronymTerms = isShortAcronymQuery(search) ? acronymAliases[searchText] ?? [searchText] : undefined;

    const matchesSearchText = (value: string | number | undefined | null) => {
      const normalized = normalizeSearchText(value);
      if (normalized === '') return false;
      if (acronymTerms) {
        return acronymTerms.some((term) => {
          const normalizedTerm = normalizeSearchText(term);
          if (normalizedTerm === '') return false;
          const regex = new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`);
          return regex.test(normalized);
        });
      }
      return normalized.includes(searchText);
    };

    if (searchEoNumber) {
      const exactEoMatches = filteredOrders.filter(
        (order) => normalizeEoNumber(order.executive_order_number) === searchEoNumber
      );
      if (exactEoMatches.length > 0) {
        return exactEoMatches;
      }
      return [];
    }

    const tier1 = filteredOrders.filter((order) => exactMatch(order.executive_order_number));
    const tier2 = filteredOrders.filter((order) => !exactMatch(order.executive_order_number) && startsWith(order.executive_order_number));
    const tier3 = filteredOrders.filter((order) => exactMatch(order.president));
    const tier4 = filteredOrders.filter(
      (order) => !exactMatch(order.president) && (startsWith(order.president) || matchesSearchText(order.president))
    );
    const tier5 = filteredOrders.filter((order) => exactMatch(order.title));
    const tier6 = filteredOrders.filter(
      (order) => !exactMatch(order.title) && (startsWith(order.title) || matchesSearchText(order.title))
    );
    const tier7 = filteredOrders.filter(
      (order) => exactMatch(order.citation) || exactMatch(order.document_number)
    );
    const tier8 = filteredOrders.filter(
      (order) =>
        exactMatch(order.signing_date) ||
        exactMatch(order.publication_date) ||
        exactMatch(order.year) ||
        exactMatch(order.start_page) ||
        exactMatch(order.end_page)
    );
    const tier9 = filteredOrders.filter((order) => {
      const fullTextPlain = getOrderFullTextPlain(order);
      return fullTextPlain ? matchesSearchText(fullTextPlain) : false;
    });

    const combined: ExecutiveOrder[] = [];
    const seen = new Set<string>();

    addUniqueOrders(combined, tier1, seen);
    addUniqueOrders(combined, tier2, seen);
    addUniqueOrders(combined, tier3, seen);
    addUniqueOrders(combined, tier4, seen);
    addUniqueOrders(combined, tier5, seen);
    addUniqueOrders(combined, tier6, seen);
    addUniqueOrders(combined, tier7, seen);
    addUniqueOrders(combined, tier8, seen);
    addUniqueOrders(combined, tier9, seen);

    let fuseResults = fuse.search(searchText).map((result) => result.item).filter((order) => matchesCoverageFilter(order, activeCoverageFilter));
    if (acronymTerms) {
      fuseResults = fuseResults.filter((order) => {
        const searchable = [
          order.executive_order_number,
          order.title,
          order.president,
          order.citation,
          order.document_number,
          order.disposition_notes,
          order.signing_date,
          order.publication_date,
          order.year,
          getOrderFullTextPlain(order),
        ].some(matchesSearchText);
        return searchable;
      });
    }
    addUniqueOrders(combined, fuseResults, seen);

    return combined;
  }, [fuse, search, sortedOrders, activeCoverageFilter, coverageMap]);

  const topicOptions = useMemo(() => {
    return topics.filter((topic) => rankedOrders.some((order) => matchesTopic(order, topic)));
  }, [rankedOrders]);

  const topicFilteredOrders = useMemo(() => {
    if (activeTopic === 'all' || topicOptions.length === 0) return rankedOrders;
    return rankedOrders.filter((order) => matchesTopic(order, activeTopic));
  }, [rankedOrders, activeTopic, topicOptions.length]);

  const pageSize = 100;
  const totalPages = Math.max(1, Math.ceil(topicFilteredOrders.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, topicFilteredOrders.length);
  const displayedOrders = topicFilteredOrders.slice(startIndex, endIndex);
  const displayStart = topicFilteredOrders.length > 0 ? startIndex + 1 : 0;
  const displayEnd = endIndex;

  const getFiltersSummary = () => {
    const phrases: string[] = [];
    if (search.trim()) {
      phrases.push(`for “${search.trim()}”`);
    }
    if (activeTopic !== 'all' && topicOptions.length > 0) {
      phrases.push(`narrowed by topic “${activeTopic}”`);
    }
    if (activeCoverageFilter !== 'all') {
      const filterLabel =
        activeCoverageFilter === 'available'
          ? 'Full-text available'
          : activeCoverageFilter === 'missing_source'
          ? 'Metadata-only / missing source'
          : 'Unknown EO number';
      phrases.push(`in ${filterLabel}`);
    }
    return phrases.length ? ` ${phrases.join(' ')}` : '';
  };
  const StackedDocumentsIcon = () => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 1 7l11 5 11-5-11-5z" />
      <path d="M2 12l10 5 10-5" />
      <path d="M2 17l10 5 10-5" />
    </svg>
  );

  const DocumentIcon = () => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="15" y2="16" />
    </svg>
  );

  const QuestionCircleIcon = () => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.82 1c0 1.5-2 1.5-2 3" />
      <path d="M12 17h.01" />
    </svg>
  );

  const ExclamationTriangleIcon = () => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3.05h16.94a2 2 0 0 0 1.71-3.05l-8.47-14.14a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );

  const DocumentPdfIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
  );

  const ExternalLinkIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );

  const CodeIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Executive Orders Dashboard</p>
          <h1>Executive Orders</h1>
          <p className="subtitle">
            Browse executive orders with basic metadata, PDF links, and Federal Register pages.
          </p>
          <div className="coverage-cards">
            <div
              className={`coverage-card ${activeCoverageFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveCoverageFilter('all')}
            >
              <div>
                <div className="coverage-card__label">Total records loaded</div>
                <div className="coverage-card__value">{coverageSummary.formatNumber(coverageSummary.totalRecords)}</div>
              </div>
              <div className="coverage-card__icon"><StackedDocumentsIcon /></div>
            </div>
            <div
              className={`coverage-card ${activeCoverageFilter === 'available' ? 'active' : ''}`}
              onClick={() => setActiveCoverageFilter('available')}
            >
              <div>
                <div className="coverage-card__label">Full-text available</div>
                <div className="coverage-card__value">{coverageSummary.formatNumber(coverageSummary.fullTextAvailable)}</div>
              </div>
              <div className="coverage-card__icon"><DocumentIcon /></div>
            </div>
            <div
              className={`coverage-card ${activeCoverageFilter === 'missing_source' ? 'active' : ''}`}
              onClick={() => setActiveCoverageFilter('missing_source')}
            >
              <div>
                <div className="coverage-card__label">Metadata-only / missing source</div>
                <div className="coverage-card__value">{coverageSummary.formatNumber(coverageSummary.missingSource)}</div>
              </div>
              <div className="coverage-card__icon"><QuestionCircleIcon /></div>
            </div>
            <div
              className={`coverage-card ${activeCoverageFilter === 'unknown_eo' ? 'active' : ''}`}
              onClick={() => setActiveCoverageFilter('unknown_eo')}
            >
              <div>
                <div className="coverage-card__label">Unknown EO number</div>
                <div className="coverage-card__value">{coverageSummary.formatNumber(coverageSummary.unknownEoCount)}</div>
              </div>
              <div className="coverage-card__icon"><ExclamationTriangleIcon /></div>
            </div>
          </div>
          <div className={`about-summary ${aboutOpen ? 'about-summary--expanded' : ''}`}>
            <button
              type="button"
              onClick={() => setAboutOpen((open) => !open)}
              className="about-summary__toggle"
            >
              {aboutOpen ? 'Hide about this data' : 'About this data'}
            </button>
            {aboutOpen ? (
              <div className="about-summary__content">
                <p>
                  The dashboard uses public executive order source data. Full-text available means searchable extracted text exists.
                </p>
                <p>
                  Metadata-only / missing source means direct XML/JSON/HTML full-text links were unavailable. Some older historical records may only be accessible through scanned archival PDFs.
                </p>
                <p>
                  Unknown EO number means the EO number field is missing and fallback metadata is used where available.
                </p>
                <p>
                  Topic filters use curated keyword matching from metadata and available full text, not AI-generated classification.
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <div className="search-group">
          <div className="search-row">
            <div className="search-field">
              <label htmlFor="search">Search executive orders</label>
              <input
                id="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by number, title, president, citation, document number..."
              />
            </div>
            <div className="topic-field">
              <label htmlFor="topic-filter">Narrow by topic</label>
              <select
                id="topic-filter"
                value={activeTopic}
                disabled={topicOptions.length === 0}
                onChange={(event) => {
                  setActiveTopic(event.target.value);
                  setCurrentPage(1);
                }}
              >
                {topicOptions.length > 0 ? (
                  <>
                    <option value="all">All topics</option>
                    {topicOptions.map((topic) => (
                      <option key={topic} value={topic}>
                        {topic}
                      </option>
                    ))}
                  </>
                ) : (
                  <option value="all">No topic filters available</option>
                )}
              </select>
            </div>
          </div>
          <p className="search-note">Search includes metadata and available full text.</p>
        </div>
        {activeCoverageFilter !== 'all' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#374151', fontSize: '0.95rem' }}>
            <span>Active data filter: {activeCoverageFilter === 'available' ? 'Full-text available' : activeCoverageFilter === 'missing_source' ? 'Metadata-only / missing source' : 'Unknown EO number'}</span>
            <button
              type="button"
              onClick={() => setActiveCoverageFilter('all')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#2563eb',
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              Clear filter
            </button>
          </div>
        ) : null}
      </header>

      <main>
        {loading ? (
          <div className="status-message">Loading sample data…</div>
        ) : error ? (
          <div className="status-message error">{error}</div>
        ) : (
          <div className="table-container">
            <div className="record-count">
              {topicFilteredOrders.length > 0
                ? `Showing ${displayStart}–${displayEnd} of ${topicFilteredOrders.length} matching records.${getFiltersSummary()}`
                : 'No matching records found.'}
            </div>
            <table>
              <caption className="sr-only">Executive order records</caption>
              <thead>
                <tr>
                  <th>EO #</th>
                  <th>Title</th>
                  <th>President</th>
                  <th>Signed</th>
                  <th>Published</th>
                  <th>Citation</th>
                  <th>Sources</th>
                </tr>
              </thead>
              <tbody>
                {rankedOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No executive orders match your search.
                    </td>
                  </tr>
                ) : (
                  displayedOrders.map((order, index) => {
                    const rowKey = order.document_number
                      ? order.document_number
                      : `${order.executive_order_number ?? ''}|${order.publication_date ?? ''}|${order.signing_date ?? ''}|${index}`;

                    const isExpanded = expandedRows.has(rowKey);
                    return (
                      <tr key={rowKey}>
                        <td>{order.executive_order_number}</td>
                        <td className="title-cell">
                          <div className="title-cell__text">{order.title}</div>
                          <button
                            type="button"
                            className={`preview-toggle ${isExpanded ? 'preview-toggle--active' : ''}`}
                            onClick={() => {
                              setExpandedRows((current) => {
                                const next = new Set(current);
                                if (next.has(rowKey)) {
                                  next.delete(rowKey);
                                } else {
                                  next.add(rowKey);
                                }
                                return next;
                              });
                            }}
                          >
                            {isExpanded ? 'Hide text preview' : 'Show text preview'}
                          </button>
                          {isExpanded ? (
                            <div className="title-preview">
                              {getTextPreview(order)}
                            </div>
                          ) : null}
                        </td>
                        <td className="nowrap-cell">{order.president}</td>
                        <td className="nowrap-cell">{order.signing_date}</td>
                        <td className="nowrap-cell">{order.publication_date}</td>
                        <td className="nowrap-cell">{order.citation}</td>
                        <td className="actions-cell">
                          {order.pdf_url ? (
                            <a
                              className="button button--pdf"
                              href={order.pdf_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <DocumentPdfIcon />
                              Download PDF
                            </a>
                          ) : (
                            <span className="muted">No PDF</span>
                          )}
                          {order.html_url ? (
                            <a
                              className="button secondary button--external"
                              href={order.html_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLinkIcon />
                              Open Federal Register Page
                            </a>
                          ) : null}
                          {order.json_url ? (
                            <a
                              className="button secondary button--code"
                              href={order.json_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <CodeIcon />
                              Open Source JSON
                            </a>
                          ) : null}
                          {!order.pdf_url && !order.html_url && !order.json_url ? (
                            <span className="no-sources">No sources available</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {rankedOrders.length > 0 && totalPages > 1 ? (
              <div className="pagination-controls">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="pagination-button"
                >
                  Previous
                </button>
                <span className="pagination-info">Page {currentPage} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="pagination-button"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
