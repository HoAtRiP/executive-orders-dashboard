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

    const matchingEoNumber = searchEoNumber
      ? filteredOrders.filter((order) => normalizeEoNumber(order.executive_order_number) === searchEoNumber)
      : [];

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

    if (searchEoNumber) {
      addUniqueOrders(combined, matchingEoNumber, seen);
    }
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Executive Orders Dashboard</p>
          <h1>Executive Orders</h1>
          <p className="subtitle">
            Browse executive orders with basic metadata, PDF links, and Federal Register pages.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginTop: '1rem',
            }}
          >
            <div
              onClick={() => setActiveCoverageFilter('all')}
              style={{
                padding: '0.9rem 1rem',
                background: activeCoverageFilter === 'all' ? '#e0efff' : '#f9fafb',
                border: activeCoverageFilter === 'all' ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <div style={{ color: '#4b5563', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                Total records loaded
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                {coverageSummary.totalRecords}
              </div>
            </div>
            <div
              onClick={() => setActiveCoverageFilter('available')}
              style={{
                padding: '0.9rem 1rem',
                background: activeCoverageFilter === 'available' ? '#e0efff' : '#f9fafb',
                border: activeCoverageFilter === 'available' ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <div style={{ color: '#4b5563', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                Full-text available
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                {coverageSummary.fullTextAvailable}
              </div>
            </div>
            <div
              onClick={() => setActiveCoverageFilter('missing_source')}
              style={{
                padding: '0.9rem 1rem',
                background: activeCoverageFilter === 'missing_source' ? '#e0efff' : '#f9fafb',
                border: activeCoverageFilter === 'missing_source' ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <div style={{ color: '#4b5563', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                Metadata-only / missing source
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                {coverageSummary.missingSource}
              </div>
            </div>
            <div
              onClick={() => setActiveCoverageFilter('unknown_eo')}
              style={{
                padding: '0.9rem 1rem',
                background: activeCoverageFilter === 'unknown_eo' ? '#e0efff' : '#f9fafb',
                border: activeCoverageFilter === 'unknown_eo' ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                borderRadius: '14px',
                cursor: 'pointer',
                transition: 'background 0.2s ease, border-color 0.2s ease',
              }}
            >
              <div style={{ color: '#4b5563', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                Unknown EO number
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                {coverageSummary.unknownEoCount}
              </div>
            </div>
          </div>
          <p
            style={{
              margin: '0.75rem 0 0',
              color: '#4b5563',
              maxWidth: '720px',
              fontSize: '0.95rem',
              lineHeight: 1.6,
            }}
          >
            Some historical records are metadata-only because direct XML/JSON/HTML source links are unavailable. Some older records may only be accessible through scanned archival PDFs.
          </p>
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
              {rankedOrders.length > 0
                ? `Showing ${displayStart}–${displayEnd} of ${topicFilteredOrders.length} matching records.`
                : 'No matching records found.'}
            </div>
            <table>
              <caption className="sr-only">Executive order records</caption>
              <thead>
                <tr>
                  <th>EO #</th>
                  <th>Title</th>
                  <th>President</th>
                  <th>Signing date</th>
                  <th>Publication date</th>
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
                        <td>
                          <div>{order.title}</div>
                          <button
                            type="button"
                            className="preview-toggle"
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
                        <td>{order.president}</td>
                        <td>{order.signing_date}</td>
                        <td>{order.publication_date}</td>
                        <td>{order.citation}</td>
                        <td className="actions-cell">
                          {order.pdf_url ? (
                            <a
                              className="button"
                              href={order.pdf_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download PDF
                            </a>
                          ) : (
                            <span className="muted">No PDF</span>
                          )}
                          {order.html_url ? (
                            <a
                              className="button secondary"
                              href={order.html_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open Federal Register Page
                            </a>
                          ) : null}
                          {order.json_url ? (
                            <a
                              className="button secondary"
                              href={order.json_url}
                              target="_blank"
                              rel="noreferrer"
                            >
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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1rem',
                  padding: '1.5rem 1rem',
                  borderTop: '1px solid #e5e7eb',
                  background: '#f9fafb',
                }}
              >
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    background: currentPage === 1 ? '#f3f4f6' : '#ffffff',
                    color: currentPage === 1 ? '#9ca3af' : '#111827',
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                    fontSize: '0.95rem',
                  }}
                >
                  Previous
                </button>
                <span style={{ color: '#374151', fontSize: '0.95rem' }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    background: currentPage === totalPages ? '#f3f4f6' : '#ffffff',
                    color: currentPage === totalPages ? '#9ca3af' : '#111827',
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '0.95rem',
                  }}
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
