// End-to-end check of auth and the booking rules against a RUNNING server (npm run dev / npm start).
//   npm run smoke                      -> http://localhost:3000
//   BASE_URL=https://my-app.onrender.com npm run smoke
// It creates two throwaway accounts, books one real slot three days ahead, tries to double-book it,
// cancels it, and deletes both accounts again.
import assert from 'node:assert/strict';
import { addDays, todayIn } from '../shared/booking.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const customer = { fullName: 'Smoke Test', email: 'smoke@example.com', phone: '555 010 1234' };
const password = 'smoke-' + Math.random().toString(36).slice(2) + 'Aa1';

// A "browser": remembers cookies between calls. `user` is null until sign-up.
function makeUser(label) {
  const jar = new Map();
  const email = `smoke-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;
  async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(BASE + '/api' + path, {
      method,
      // Better Auth rejects cookie-bearing writes whose Origin is not the app's own address.
      headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body && JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      pair.slice(i + 1) ? jar.set(pair.slice(0, i), pair.slice(i + 1)) : jar.delete(pair.slice(0, i));
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return { email, call };
}
const step = (name) => console.log('•', name);
const anon = makeUser('anon');
const alice = makeUser('alice');
const bob = makeUser('bob');

step('health');
assert.equal((await anon.call('/health')).status, 200);

step('list resources (public)');
const { data: resources } = await anon.call('/resources');
assert.ok(resources.length > 0, 'no resources (is the database seeded?)');
const resource = resources[0];
const date = addDays(todayIn(resource.timezone), 3);

step('bookings need a signed-in user (401)');
assert.equal((await anon.call('/bookings')).status, 401);
assert.equal((await anon.call('/bookings', { method: 'POST', body: { resourceId: resource.id, date, startMin: 0, slots: 1, customer } })).status, 401);
assert.equal((await anon.call('/bookings/BK-NOPE/cancel', { method: 'POST' })).status, 401);

step('sign up, session, wrong password refused');
for (const u of [alice, bob]) {
  // Production rate-limits sign-ups to a few per 10 seconds; wait the window out rather than fail.
  let up;
  for (let attempt = 0; attempt < 6; attempt++) {
    up = await u.call('/auth/sign-up/email', { method: 'POST', body: { name: 'Smoke ' + u.email.split('-')[1], email: u.email, password } });
    if (up.status !== 429) break;
    await new Promise((r) => setTimeout(r, 11000));
  }
  assert.equal(up.status, 200, JSON.stringify(up.data));
}
assert.equal((await alice.call('/auth/get-session')).data?.user?.email, alice.email);
assert.notEqual((await anon.call('/auth/sign-in/email', { method: 'POST', body: { email: alice.email, password: password + 'x' } })).status, 200);
assert.equal((await anon.call('/auth/sign-up/email', { method: 'POST', body: { name: 'x', email: 'short@example.com', password: 'short' } })).status, 400, 'short password');

step('availability');
const { status, data: avail } = await alice.call(`/resources/${resource.id}/availability?date=${date}`);
assert.equal(status, 200);
const free = avail.slots.find((s) => s.available);
assert.ok(free, `no free slot on ${date}; rerun after cancelling old smoke bookings`);

step('rejects bad input');
const post = (u, body) => u.call('/bookings', { method: 'POST', body });
assert.equal((await post(alice, { resourceId: resource.id, date, startMin: free.startMin, slots: 1, customer: {} })).status, 400);
assert.equal((await post(alice, { resourceId: resource.id, date, startMin: free.startMin + 1, slots: 1, customer })).status, 400, 'off-grid start');

step('book, ignoring a client-sent price');
const body = { resourceId: resource.id, date, startMin: free.startMin, slots: 1, customer, total: 0.01 };
const booked = await post(alice, body);
assert.equal(booked.status, 201, JSON.stringify(booked.data));
assert.equal(booked.data.total, resource.pricePerSlot);

step('double-booking is refused (409)');
assert.equal((await post(bob, body)).status, 409);

step('slot now shows as taken');
const again = await alice.call(`/resources/${resource.id}/availability?date=${date}`);
assert.equal(again.data.slots.find((s) => s.startMin === free.startMin).taken, true);

step('only the owner sees and can cancel it');
assert.equal((await bob.call('/bookings')).data.length, 0);
assert.equal((await bob.call(`/bookings/${booked.data.id}/cancel`, { method: 'POST' })).status, 404);
assert.ok((await alice.call('/bookings')).data.some((b) => b.id === booked.data.id));

step('cancel frees the slot');
assert.equal((await alice.call(`/bookings/${booked.data.id}/cancel`, { method: 'POST' })).data.status, 'cancelled');
const rebook = await post(bob, body);
assert.equal(rebook.status, 201);
assert.equal((await bob.call(`/bookings/${rebook.data.id}/cancel`, { method: 'POST' })).data.status, 'cancelled');

step('sign out ends the session; sign in again works');
await alice.call('/auth/sign-out', { method: 'POST', body: {} });
assert.equal((await alice.call('/bookings')).status, 401);
assert.equal((await alice.call('/auth/sign-in/email', { method: 'POST', body: { email: alice.email, password } })).status, 200);
assert.equal((await alice.call('/bookings')).status, 200);

step('delete the throwaway accounts');
for (const u of [alice, bob]) assert.equal((await u.call('/auth/delete-user', { method: 'POST', body: { password } })).status, 200);
assert.equal((await alice.call('/bookings')).status, 401);
console.log('\nAll checks passed. Smoke bookings were cancelled and the smoke accounts deleted.');
