import { useEffect, useMemo, useState } from 'react';
import type { ExecutiveOrder } from './types';
import './App.css';

function App() {
  const [orders, setOrders] = useState<ExecutiveOrder[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/data/sample-executive-orders.json');
        if (!response.ok) {
          throw new Error(`Failed to load sample data: ${response.status}`);
        }
        const data = (await response.json()) as ExecutiveOrder[];
        setOrders(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return orders;
    }

    const hasPdf = (order: ExecutiveOrder) => Boolean(order.pdf_url);
    const isPdfAvailableSearch = term === 'pdf' || term === 'available' || term === 'pdf available';
    const isPdfUnavailableSearch = term === 'no pdf' || term === 'unavailable' || term === 'pdf unavailable';

    if (isPdfAvailableSearch) {
      return orders.filter(hasPdf);
    }

    if (isPdfUnavailableSearch) {
      return orders.filter((order) => !hasPdf(order));
    }

    return orders.filter((order) => {
      return [
        order.eo_number,
        order.title,
        order.president,
        order.signing_date,
        order.publication_date,
        order.citation,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [orders, search]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Executive Orders Dashboard</p>
          <h1>Executive Orders</h1>
          <p className="subtitle">
            Browse sample executive orders with basic metadata, PDF links, and Federal Register pages.
          </p>
        </div>
        <div className="search-group">
          <label htmlFor="search">Search executive orders</label>
          <input
            id="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by number, title, president, citation..."
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
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No executive orders match your search.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => (
                    <tr key={order.eo_number}>
                      <td>{order.eo_number}</td>
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
                            Open PDF
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
                      </td>
                    </tr>
                  ))
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
