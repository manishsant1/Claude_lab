import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cancelBooking, getBookings } from '../api/api';
import { CANCEL_CUTOFF_HOURS, LABELS } from '../../shared/config';
import { formatPrice, formatWhen } from '../lib/format';

export default function Bookings() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const justBooked = useLocation().state?.justBooked;

  useEffect(() => {
    getBookings().then(setBookings).catch((err) => setError(err.message));
  }, []);

  const cancel = async (b) => {
    if (!window.confirm(`Cancel ${b.resourceName} on ${formatWhen(b.startsAt, b.timezone)}?`)) return;
    setBusyId(b.id);
    setError(null);
    try {
      const updated = await cancelBooking(b.id);
      setBookings((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!bookings) return error ? <p className="alert">{error}</p> : <p className="muted">Loading…</p>;

  // The server enforces the cutoff; this only decides whether to offer the button.
  const canCancel = (b) =>
    b.status === 'confirmed' && new Date(b.startsAt).getTime() - Date.now() >= CANCEL_CUTOFF_HOURS * 3600 * 1000;

  return (
    <>
      {justBooked && (
        <div className="banner">🎉 Thank you! Your {LABELS.booking.toLowerCase()} <strong>{justBooked}</strong> is confirmed.</div>
      )}
      <h1>My {LABELS.bookings.toLowerCase()}</h1>
      {error && <p className="alert">{error}</p>}
      {bookings.length === 0 ? (
        <div className="empty">
          <p>You haven't made any {LABELS.bookings.toLowerCase()} yet.</p>
          <Link to="/" className="btn">Browse {LABELS.resources.toLowerCase()}</Link>
        </div>
      ) : (
        bookings.map((b) => (
          <div key={b.id} className={`panel order ${b.id === justBooked ? 'highlight' : ''} ${b.status === 'cancelled' ? 'cancelled' : ''}`}>
            <div className="order-head">
              <div>
                <strong>{b.resourceEmoji} {b.resourceName}</strong>
                <div className="muted small">{b.id}</div>
              </div>
              <span className={`status ${b.status}`}>{b.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}</span>
              <strong>{formatPrice(b.total)}</strong>
            </div>
            <div>{formatWhen(b.startsAt, b.timezone)}</div>
            {canCancel(b) && (
              <button className="link-btn danger" disabled={busyId === b.id} onClick={() => cancel(b)}>
                {busyId === b.id ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
          </div>
        ))
      )}
    </>
  );
}
