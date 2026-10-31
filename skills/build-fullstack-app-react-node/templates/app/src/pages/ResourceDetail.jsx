import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getAvailability, getResource } from '../api/api';
import { LABELS, MAX_ADVANCE_DAYS } from '../../shared/config';
import { addDays, bookingTotals, formatMinutes, todayIn } from '../../shared/booking';
import { formatDay, formatPrice } from '../lib/format';

export default function ResourceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [resource, setResource] = useState(undefined); // undefined = loading, null = not found
  const [date, setDate] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [error, setError] = useState(null);
  const [start, setStart] = useState(null);
  const [count, setCount] = useState(1);

  // The `off` flags drop responses that arrive after the user has already moved on
  // (another date or resource), so a slow reply can't overwrite a newer one.
  useEffect(() => {
    let off = false;
    setResource(undefined);
    getResource(id)
      .then((r) => {
        if (off) return;
        setResource(r);
        if (r) setDate(todayIn(r.timezone));
      })
      .catch((err) => !off && setError(err.message));
    return () => { off = true; };
  }, [id]);

  useEffect(() => {
    if (!resource || !date) return;
    let off = false;
    setAvailability(null);
    setStart(null);
    getAvailability(resource.id, date)
      .then((a) => !off && setAvailability(a))
      .catch((err) => !off && setError(err.message));
    return () => { off = true; };
  }, [resource, date]);

  const availableAt = useMemo(
    () => new Set((availability?.slots ?? []).filter((s) => s.available).map((s) => s.startMin)),
    [availability],
  );

  // How many consecutive slots can be booked from the chosen start.
  const maxCount = useMemo(() => {
    if (start === null || !resource) return 0;
    let n = 0;
    while (n < resource.maxSlots && availableAt.has(start + n * resource.slotMinutes)) n++;
    return n;
  }, [start, availableAt, resource]);

  if (error) return <p className="alert">{error}</p>;
  if (resource === undefined) return <p className="muted">Loading…</p>;
  if (resource === null) {
    return (
      <div className="empty">
        <h2>{LABELS.resource} not found</h2>
        <Link to="/" className="btn">Browse {LABELS.resources.toLowerCase()}</Link>
      </div>
    );
  }

  const today = todayIn(resource.timezone);
  const picked = start === null ? 0 : Math.min(count, maxCount);
  const inPicked = (m) => start !== null && m >= start && m < start + picked * resource.slotMinutes;
  const totals = bookingTotals(resource.pricePerSlot, picked || 1);

  return (
    <div className="detail-grid">
      <div>
        <div className="thumb large">{resource.emoji}</div>
      </div>
      <div className="detail">
        <span className="muted small">{resource.category}</span>
        <h1>{resource.name}</h1>
        <p>{resource.description}</p>
        <div className="price big">
          {formatPrice(resource.pricePerSlot)} <span className="muted small">/ {resource.slotMinutes} min</span>
        </div>
        <p className="muted small">
          Open {formatMinutes(resource.openMin)} – {formatMinutes(resource.closeMin)} · times shown in {resource.timezone}
        </p>

        <label className="field">
          Date
          <input
            type="date"
            value={date ?? ''}
            min={today}
            max={addDays(today, MAX_ADVANCE_DAYS)}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>

        {date && <h3>{formatDay(date)}</h3>}
        {!availability ? (
          <p className="muted">Loading times…</p>
        ) : (
          <div className="slots">
            {availability.slots.map((s) => (
              <button
                key={s.startMin}
                type="button"
                className={`slot ${inPicked(s.startMin) ? 'selected' : ''}`}
                disabled={!s.available}
                title={s.taken ? 'Already booked' : s.past ? 'In the past' : ''}
                onClick={() => { setStart(s.startMin); setCount(1); }}
              >
                {formatMinutes(s.startMin)}
              </button>
            ))}
          </div>
        )}

        {start !== null && (
          <div className="panel pick">
            <label className="field">
              Length
              <select value={picked} onChange={(e) => setCount(Number(e.target.value))}>
                {Array.from({ length: maxCount }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n * resource.slotMinutes} min</option>
                ))}
              </select>
            </label>
            <p>
              {formatMinutes(start)} – {formatMinutes(start + picked * resource.slotMinutes)} ·{' '}
              <strong>{formatPrice(totals.total)}</strong>
            </p>
            <button
              className="btn block"
              onClick={() => navigate('/book', { state: { resourceId: resource.id, date, startMin: start, slots: picked } })}
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
