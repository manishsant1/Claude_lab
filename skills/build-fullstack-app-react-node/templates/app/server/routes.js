import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';
import * as db from './db.js';
import { HttpError } from './errors.js';
import { CUSTOMER_FIELDS, validateCustomer } from '../shared/validation.js';
import { checkBookingDate } from '../shared/booking.js';

const router = express.Router();

// The signed-in user's id, from the Better Auth session cookie. Browsing is public; everything
// that touches a person's bookings goes through here. Records are always scoped by this id.
async function requireUser(req) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new HttpError(401, 'Please sign in to continue');
  return session.user.id;
}

router.get('/health', async (req, res) => {
  await db.ping();
  res.json({ ok: true });
});

router.get('/categories', async (req, res) => res.json(await db.getCategories()));

router.get('/resources', async (req, res) => res.json(await db.getResources()));

router.get('/resources/:id', async (req, res) => {
  const resource = await db.getResource(req.params.id);
  if (!resource) throw new HttpError(404, 'Not found');
  res.json(resource);
});

router.get('/resources/:id/availability', async (req, res) => {
  const resource = await db.getResource(req.params.id);
  if (!resource) throw new HttpError(404, 'Not found');
  const date = String(req.query.date ?? '');
  const problem = checkBookingDate(date, resource.timezone);
  if (problem) throw new HttpError(400, problem);
  res.json(await db.getAvailability(resource.id, date));
});

router.get('/bookings', async (req, res) => {
  res.json(await db.getBookingsForUser(await requireUser(req)));
});

router.post('/bookings', async (req, res) => {
  const userId = await requireUser(req);
  const { resourceId, date, startMin, slots, customer = {} } = req.body ?? {};

  if (typeof resourceId !== 'string' || typeof date !== 'string') throw new HttpError(400, 'Invalid request');
  if (!Number.isInteger(startMin) || !Number.isInteger(slots) || slots < 1 || slots > 100) {
    throw new HttpError(400, 'Invalid time selection');
  }
  const errors = validateCustomer(customer);
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields', errors);

  // Price, hours and availability are decided by the database, never by the request.
  const booking = await db.createBooking({
    userId,
    resourceId,
    date,
    startMin,
    slots,
    // Keep only the known fields, trimmed.
    customer: Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f.name, customer[f.name].trim()])),
  });
  res.status(201).json(booking);
});

router.post('/bookings/:id/cancel', async (req, res) => {
  res.json(await db.cancelBooking(await requireUser(req), req.params.id));
});

router.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Express 5 forwards errors thrown in handlers (sync or async) to this handler.
router.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

export default router;
