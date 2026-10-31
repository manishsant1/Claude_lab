import { CURRENCY } from '../../shared/config';

export const formatPrice = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY }).format(n);

// Shows a booked instant in the resource's own timezone, e.g. "Sat, Oct 24, 9:00 AM EDT".
export function formatWhen(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(new Date(iso));
}

// "YYYY-MM-DD" -> "Saturday, October 24". Parsed as UTC and formatted as UTC so the viewer's
// own timezone can never shift the day.
export function formatDay(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(date + 'T00:00:00Z'));
}
