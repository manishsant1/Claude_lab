// Postgres data access, using Neon's serverless driver. This is the only file with SQL.
// The Pool talks to Neon over WebSockets, which supports full transactions (needed for bookings).
import { randomUUID } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { MAX_ACTIVE_BOOKINGS_PER_CLIENT, CANCEL_CUTOFF_HOURS } from '../shared/config.js';
import { bookingTotals, checkBookingDate, checkSlotRange } from '../shared/booking.js';
import { HttpError } from './errors.js';
import { RESOURCES } from './seed.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add your Neon connection string to .env (see .env.example).');
  process.exit(1);
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('Database connection error:', err.message));

// Idempotent, so it is safe to run on every start. There is no migration tool: a change to an
// existing table needs a manual ALTER (add it here too so fresh databases match).
//
// Times of day are integers (minutes since midnight, in the resource's timezone). Booked
// intervals are timestamptz. The exclusion constraint is what makes double-booking impossible:
// Postgres rejects any confirmed booking that overlaps another on the same resource, no matter
// how many requests race. Cancelled bookings are excluded, so their time can be booked again.
const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS btree_gist;

  CREATE TABLE IF NOT EXISTS resources (
    id             text PRIMARY KEY,
    name           text NOT NULL,
    category       text NOT NULL,
    description    text NOT NULL DEFAULT '',
    emoji          text NOT NULL DEFAULT '',
    price_per_slot numeric(10, 2) NOT NULL CHECK (price_per_slot >= 0),
    slot_minutes   integer NOT NULL CHECK (slot_minutes > 0),
    open_min       integer NOT NULL CHECK (open_min >= 0),
    close_min      integer NOT NULL CHECK (close_min <= 1440),
    max_slots      integer NOT NULL DEFAULT 4 CHECK (max_slots > 0),
    timezone       text NOT NULL DEFAULT 'UTC',
    active         boolean NOT NULL DEFAULT true,
    CHECK (close_min > open_min)
  );

  -- Name, emoji, timezone and prices are copied at booking time so past bookings don't
  -- change when the resource does.
  CREATE TABLE IF NOT EXISTS bookings (
    id             text PRIMARY KEY,
    user_id      text NOT NULL,
    resource_id    text NOT NULL REFERENCES resources(id),
    resource_name  text NOT NULL,
    resource_emoji text NOT NULL,
    timezone       text NOT NULL,
    starts_at      timestamptz NOT NULL,
    ends_at        timestamptz NOT NULL,
    slots          integer NOT NULL CHECK (slots > 0),
    status         text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    customer       jsonb NOT NULL,
    subtotal       numeric(10, 2) NOT NULL,
    tax            numeric(10, 2) NOT NULL,
    total          numeric(10, 2) NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
      resource_id WITH =,
      tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status = 'confirmed')
  );
  CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id, starts_at DESC);
`;

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Creates the tables and, on an empty database, loads the starter data.
export async function init() {
  await pool.query(SCHEMA);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM resources');
    if (rows[0].n > 0) return;
    for (const r of RESOURCES) {
      await client.query(
        `INSERT INTO resources (id, name, category, description, emoji, price_per_slot,
                                slot_minutes, open_min, close_min, max_slots, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
        [r.id, r.name, r.category, r.description, r.emoji, r.pricePerSlot,
          r.slotMinutes, r.openMin, r.closeMin, r.maxSlots, r.timezone],
      );
    }
    console.log(`Seeded ${RESOURCES.length} resources`);
  });
}

export async function ping() {
  await pool.query('SELECT 1');
}

// Postgres returns numeric columns as strings to avoid precision loss; prices fit in a JS number.
const toResource = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  description: r.description,
  emoji: r.emoji,
  pricePerSlot: Number(r.price_per_slot),
  slotMinutes: r.slot_minutes,
  openMin: r.open_min,
  closeMin: r.close_min,
  maxSlots: r.max_slots,
  timezone: r.timezone,
});

const toBooking = (r) => ({
  id: r.id,
  status: r.status,
  resourceId: r.resource_id,
  resourceName: r.resource_name,
  resourceEmoji: r.resource_emoji,
  timezone: r.timezone,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  slots: r.slots,
  customer: r.customer,
  subtotal: Number(r.subtotal),
  tax: Number(r.tax),
  total: Number(r.total),
  createdAt: r.created_at,
});

export async function getCategories() {
  const { rows } = await pool.query('SELECT DISTINCT category FROM resources WHERE active ORDER BY category');
  return rows.map((r) => r.category);
}

export async function getResources() {
  const { rows } = await pool.query('SELECT * FROM resources WHERE active ORDER BY name');
  return rows.map(toResource);
}

export async function getResource(id) {
  const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1 AND active', [id]);
  return rows[0] ? toResource(rows[0]) : null;
}

// One row per slot of the day, flagged as taken (overlaps a confirmed booking) or past.
// `date` is a validated "YYYY-MM-DD" in the resource's timezone. Postgres does the timezone
// conversion, so daylight-saving changes are handled correctly.
export async function getAvailability(resourceId, date) {
  const resource = await getResource(resourceId);
  if (!resource) return null;
  const { rows } = await pool.query(
    `SELECT m AS start_min,
            ((($2::date + make_interval(mins => m)) AT TIME ZONE $3) <= now()) AS past,
            EXISTS (
              SELECT 1 FROM bookings b
               WHERE b.resource_id = $1 AND b.status = 'confirmed'
                 AND tstzrange(b.starts_at, b.ends_at) &&
                     tstzrange(($2::date + make_interval(mins => m)) AT TIME ZONE $3,
                               ($2::date + make_interval(mins => m + $6::int)) AT TIME ZONE $3)
            ) AS taken
       FROM generate_series($4::int, $5::int - $6::int, $6::int) AS m
      ORDER BY m`,
    [resourceId, date, resource.timezone, resource.openMin, resource.closeMin, resource.slotMinutes],
  );
  return {
    date,
    slots: rows.map((r) => ({ startMin: r.start_min, past: r.past, taken: r.taken, available: !r.past && !r.taken })),
  };
}

export async function getBookingsForUser(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE user_id = $1 ORDER BY starts_at DESC',
    [userId],
  );
  return rows.map(toBooking);
}

// Validates the request against the resource's real hours, prices it from the database and
// records the booking, all in one transaction. The client sends only what it wants
// ({ resourceId, date, startMin, slots }); any price it sends is ignored.
export async function createBooking({ userId, resourceId, date, startMin, slots, customer }) {
  return withTransaction(async (client) => {
    // Lock the resource so concurrent requests for it queue up. The exclusion constraint on
    // bookings is the real guarantee; the lock just makes the loser's error arrive cleanly.
    const { rows: [row] } = await client.query(
      'SELECT * FROM resources WHERE id = $1 AND active FOR UPDATE',
      [resourceId],
    );
    if (!row) throw new HttpError(404, 'That item no longer exists');
    const resource = toResource(row);

    const problem = checkBookingDate(date, resource.timezone) ?? checkSlotRange(resource, startMin, slots);
    if (problem) throw new HttpError(400, problem);

    const { rows: [{ n: active }] } = await client.query(
      `SELECT count(*)::int AS n FROM bookings
        WHERE user_id = $1 AND status = 'confirmed' AND ends_at > now()`,
      [userId],
    );
    if (active >= MAX_ACTIVE_BOOKINGS_PER_CLIENT) {
      throw new HttpError(409, `You can have at most ${MAX_ACTIVE_BOOKINGS_PER_CLIENT} upcoming bookings. Cancel one first.`);
    }

    const endMin = startMin + slots * resource.slotMinutes;
    const { rows: [t] } = await client.query(
      `SELECT ($1::date + make_interval(mins => $2::int)) AT TIME ZONE $4 AS starts_at,
              ($1::date + make_interval(mins => $3::int)) AT TIME ZONE $4 AS ends_at`,
      [date, startMin, endMin, resource.timezone],
    );
    if (t.starts_at <= new Date()) throw new HttpError(400, 'That time has already passed');

    const totals = bookingTotals(resource.pricePerSlot, slots);
    const id = 'BK-' + randomUUID().slice(0, 8).toUpperCase();
    try {
      const { rows: [booking] } = await client.query(
        `INSERT INTO bookings (id, user_id, resource_id, resource_name, resource_emoji, timezone,
                               starts_at, ends_at, slots, customer, subtotal, tax, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [id, userId, resource.id, resource.name, resource.emoji, resource.timezone,
          t.starts_at, t.ends_at, slots, customer, totals.subtotal, totals.tax, totals.total],
      );
      return toBooking(booking);
    } catch (err) {
      // 23P01 = exclusion_violation: someone else holds an overlapping time.
      if (err.code === '23P01') throw new HttpError(409, 'Sorry, that time was just booked. Please pick another.');
      throw err;
    }
  });
}

// Customers can only cancel their own bookings, and not too close to the start time.
// Idempotent: cancelling an already-cancelled booking succeeds.
export async function cancelBooking(userId, id) {
  return withTransaction(async (client) => {
    const { rows: [b] } = await client.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    // Someone else's booking looks the same as a missing one.
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b.status === 'cancelled') return toBooking(b);
    if (b.starts_at.getTime() - Date.now() < CANCEL_CUTOFF_HOURS * 3600 * 1000) {
      throw new HttpError(409, `Bookings can only be cancelled at least ${CANCEL_CUTOFF_HOURS} hours before they start`);
    }
    const { rows: [updated] } = await client.query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [id],
    );
    return toBooking(updated);
  });
}

export async function close() {
  await pool.end();
}
