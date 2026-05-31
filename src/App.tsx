import { useEffect, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import type { ExecutiveOrder } from './types';
import './App.css';

function App() {
  const [orders, setOrders] = useState<ExecutiveOrder[]>([]);
  const [fullTextRecords, setFullTextRecords] = useState<any[]>([]);
  const [search, setSearch] = useState('');
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

  const rankedOrders = useMemo(() => {
    const searchText = normalizeSearchText(search);
    if (!searchText) {
      return sortedOrders;
    }

    const hasPdf = (order: ExecutiveOrder) => Boolean(order.pdf_url);
    const isPdfAvailableSearch = searchText === 'pdf' || searchText === 'available' || searchText === 'pdf available';
    const isPdfUnavailableSearch = searchText === 'no pdf' || searchText === 'unavailable' || searchText === 'pdf unavailable';

    if (isPdfAvailableSearch) {
      return sortedOrders.filter(hasPdf);
    }

    if (isPdfUnavailableSearch) {
      return sortedOrders.filter((order) => !hasPdf(order));
    }

    const searchEoNumber = extractExecutiveOrderNumber(searchText);
    const normalizedValue = (value: string | number | undefined | null) => normalizeSearchText(value);
    const exactMatch = (value: string | number | undefined | null) => normalizedValue(value) === searchText;
    const startsWith = (value: string | number | undefined | null) => normalizedValue(value).startsWith(searchText);
    const containsText = (value: string | number | undefined | null) => normalizedValue(value).includes(searchText);

    const matchingEoNumber = searchEoNumber
      ? sortedOrders.filter((order) => normalizeEoNumber(order.executive_order_number) === searchEoNumber)
      : [];

    const tier1 = sortedOrders.filter((order) => exactMatch(order.executive_order_number));
    const tier2 = sortedOrders.filter((order) => !exactMatch(order.executive_order_number) && startsWith(order.executive_order_number));
    const tier3 = sortedOrders.filter((order) => exactMatch(order.president));
    const tier4 = sortedOrders.filter(
      (order) => !exactMatch(order.president) && (startsWith(order.president) || containsText(order.president))
    );
    const tier5 = sortedOrders.filter((order) => exactMatch(order.title));
    const tier6 = sortedOrders.filter(
      (order) => !exactMatch(order.title) && (startsWith(order.title) || containsText(order.title))
    );
    const tier7 = sortedOrders.filter(
      (order) => exactMatch(order.citation) || exactMatch(order.document_number)
    );
    const tier8 = sortedOrders.filter(
      (order) =>
        exactMatch(order.signing_date) ||
        exactMatch(order.publication_date) ||
        exactMatch(order.year) ||
        exactMatch(order.start_page) ||
        exactMatch(order.end_page)
    );

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

    const fuseResults = fuse.search(searchText).map((result) => result.item);
    addUniqueOrders(combined, fuseResults, seen);

    return combined;
  }, [fuse, search, sortedOrders]);

  const displayedOrders = rankedOrders.slice(0, 100);

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
              style={{
                padding: '0.9rem 1rem',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '14px',
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
              style={{
                padding: '0.9rem 1rem',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '14px',
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
              style={{
                padding: '0.9rem 1rem',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '14px',
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
              style={{
                padding: '0.9rem 1rem',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '14px',
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
          <label htmlFor="search">Search executive orders</label>
          <input
            id="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by number, title, president, citation, document number..."
          />
        </div>
      </header>

      <main>
        {loading ? (
          <div className="status-message">Loading sample data…</div>
        ) : error ? (
          <div className="status-message error">{error}</div>
        ) : (
          <div className="table-container">
            <div className="record-count">
              Showing {displayedOrders.length} of {rankedOrders.length} matching records.
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
                  <th>PDF</th>
                  <th>Links</th>
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

                    return (
                      <tr key={rowKey}>
                        <td>{order.executive_order_number}</td>
                        <td>{order.title}</td>
                        <td>{order.president}</td>
                        <td>{order.signing_date}</td>
                        <td>{order.publication_date}</td>
                        <td>{order.citation}</td>
                        <td>{order.pdf_url ? 'Available' : 'PDF unavailable'}</td>
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
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
