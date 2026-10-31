// Booking rules shared by the browser (to preview) and the server (to enforce and charge),
// so the two always agree. Dependency-free: runs in Node and in the browser.
//
// Times of day are plain integers: minutes since midnight in the resource's own timezone
// (9:30 = 570). Real instants (timestamptz) only exist in the database, where Postgres does the
// timezone and daylight-saving conversion, so no date library is needed.
import { MAX_ADVANCE_DAYS, TAX_RATE } from './config.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function bookingTotals(pricePerSlot, slots) {
  const subtotal = pricePerSlot * slots;
  const tax = subtotal * TAX_RATE;
  return { subtotal: round2(subtotal), tax: round2(tax), total: round2(subtotal + tax) };
}

// 570 -> "9:30 AM"
export function formatMinutes(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// "YYYY-MM-DD" that is a real calendar date.
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}

// Today's date in a given IANA timezone, as "YYYY-MM-DD" (en-CA formats dates that way).
export function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

export function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Returns an error message, or null when the date may be booked.
export function checkBookingDate(date, timeZone) {
  if (!isValidDate(date)) return 'Choose a valid date';
  const today = todayIn(timeZone);
  if (date < today) return 'That date has already passed';
  if (date > addDays(today, MAX_ADVANCE_DAYS)) return `Bookings open up to ${MAX_ADVANCE_DAYS} days ahead`;
  return null;
}

// Checks a requested start/length against the resource's hours. Returns a message or null.
export function checkSlotRange(resource, startMin, slots) {
  if (!Number.isInteger(startMin) || !Number.isInteger(slots) || slots < 1) return 'Invalid time selection';
  if (slots > resource.maxSlots) return `You can book at most ${resource.maxSlots} ${resource.maxSlots === 1 ? 'slot' : 'slots'} at a time`;
  const endMin = startMin + slots * resource.slotMinutes;
  if (startMin < resource.openMin || endMin > resource.closeMin) return 'That time is outside opening hours';
  if ((startMin - resource.openMin) % resource.slotMinutes !== 0) return 'That start time is not available';
  return null;
}
