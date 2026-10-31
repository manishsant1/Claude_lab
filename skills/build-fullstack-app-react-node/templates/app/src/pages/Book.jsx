import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { createBooking, getResource } from '../api/api';
import { load, save } from '../api/storage';
import { useSession } from '../api/auth';
import { LABELS } from '../../shared/config';
import { bookingTotals, formatMinutes } from '../../shared/booking';
import { CUSTOMER_FIELDS, validateCustomer } from '../../shared/validation';
import { formatDay, formatPrice } from '../lib/format';
import Summary from '../components/Summary';

// The choice (resource, date, start, length) arrives in the router's location state, which
// the browser keeps across a reload. Opening /book directly has no state, so go back to browsing.
export default function Book() {
  const choice = useLocation().state;
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [resource, setResource] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // Remember the last contact details to make repeat bookings faster; the account fills the gaps.
  const [form, setForm] = useState(() => ({
    fullName: session?.user.name ?? '',
    email: session?.user.email ?? '',
    ...load('customer', {}),
  }));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!choice) return;
    getResource(choice.resourceId).then(setResource).catch((err) => setLoadError(err.message));
  }, [choice]);

  if (!choice) return <Navigate to="/" replace />;
  if (loadError) return <p className="alert">{loadError}</p>;
  if (!resource) return <p className="muted">Loading…</p>;

  const { date, startMin, slots } = choice;
  const endMin = startMin + slots * resource.slotMinutes;
  // Shown as an estimate; the server recalculates the price from its own data.
  const totals = bookingTotals(resource.pricePerSlot, slots);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    const errs = validateCustomer(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    save('customer', form);
    try {
      const booking = await createBooking({ resourceId: resource.id, date, startMin, slots, customer: form });
      navigate('/bookings', { state: { justBooked: booking.id }, replace: true });
    } catch (err) {
      setErrors(err.details ?? {});
      setSubmitError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1>Confirm your {LABELS.booking.toLowerCase()}</h1>
      <form className="two-col" onSubmit={handleSubmit} noValidate>
        <div className="panel">
          <h3>Your details</h3>
          <div className="form-grid">
            {CUSTOMER_FIELDS.map((f) => (
              <label key={f.name} className={errors[f.name] ? 'invalid' : ''}>
                {f.label}
                <input
                  type={f.type ?? 'text'}
                  autoComplete={f.autoComplete}
                  value={form[f.name] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
                {errors[f.name] && <span className="error">{errors[f.name]}</span>}
              </label>
            ))}
          </div>
          <p className="muted small">This is a demo. No real payment is taken.</p>
        </div>
        <aside className="panel">
          <h3>{LABELS.booking} summary</h3>
          <div className="mini-line">
            <span>{resource.emoji} {resource.name}</span>
          </div>
          <div className="mini-line">
            <span>{formatDay(date)}</span>
            <span>{formatMinutes(startMin)} – {formatMinutes(endMin)}</span>
          </div>
          <div className="mini-line">
            <span>{slots} × {resource.slotMinutes} min</span>
            <span>{formatPrice(totals.subtotal)}</span>
          </div>
          <Summary totals={totals} />
          {submitError && (
            <p className="alert">
              {submitError}
              {' '}
              <Link to={`/resource/${resource.id}`}>Choose another time</Link>
            </p>
          )}
          <button type="submit" className="btn block" disabled={submitting}>
            {submitting ? 'Booking…' : `Confirm · ${formatPrice(totals.total)}`}
          </button>
          <Link to={`/resource/${resource.id}`} className="link-btn">← Back</Link>
        </aside>
      </form>
    </>
  );
}
