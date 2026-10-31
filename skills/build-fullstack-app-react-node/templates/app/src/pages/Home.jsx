import { useEffect, useMemo, useState } from 'react';
import { getCategories, getResources } from '../api/api';
import { LABELS } from '../../shared/config';
import ResourceCard from '../components/ResourceCard';

export default function Home() {
  const [resources, setResources] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  useEffect(() => {
    Promise.all([getResources(), getCategories()])
      .then(([r, c]) => {
        setResources(r);
        setCategories(c);
      })
      .catch((err) => setError(err.message));
  }, []);

  const visible = useMemo(() => {
    if (!resources) return [];
    const q = query.trim().toLowerCase();
    return resources
      .filter((r) => category === 'All' || r.category === category)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }, [resources, query, category]);

  return (
    <>
      <section className="hero">
        <h1>Book your {LABELS.resource.toLowerCase()} in seconds.</h1>
        <p>Pick a {LABELS.resource.toLowerCase()}, choose a time, done.</p>
      </section>

      <div className="toolbar">
        <input
          type="search"
          placeholder={`Search ${LABELS.resources.toLowerCase()}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="chips">
        {['All', ...categories].map((c) => (
          <button key={c} className={`chip ${c === category ? 'active' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      {error ? (
        <p className="alert">{error}</p>
      ) : !resources ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="empty">No {LABELS.resources.toLowerCase()} match your search.</p>
      ) : (
        <div className="grid">
          {visible.map((r) => <ResourceCard key={r.id} resource={r} />)}
        </div>
      )}
    </>
  );
}
