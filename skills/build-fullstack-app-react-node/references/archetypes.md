# Domain archetypes and extension recipes

Pick the closest archetype, scaffold, then apply recipes. The template implements **A (time-slot booking)**.

## Mapping table

| Domain | Archetype | Resource | Customer makes | Slot / unit | Watch out for |
|---|---|---|---|---|---|
| Tennis / padel / badminton courts | A | Court (category = surface) | Booking | 30-60 min | Floodlight/peak pricing (recipe 5) |
| Meeting rooms / desks | A | Room (capacity, amenities) | Reservation | 15-30 min | Capacity filter; usually needs sign-in (recipe 7) |
| Doctor / dentist / therapist | A + recipes 1, 2 | Doctor (category = specialty) | Appointment | 15-30 min | Per-weekday hours, breaks; **health data**: demo only, see note |
| Salon / barber / spa | A + recipes 1, 2 | Stylist (or service) | Appointment | 15 min grid | Services with different durations (recipe 2) |
| Equipment / vehicle rentals | B | Item with quantity | Rental | day | Multi-day ranges, quantity, deposit |
| Classes / events / tickets | C | Session with capacity | Registration | seat | Capacity counting, waitlist |
| Shop / marketplace | D | Product | Order | item | See the catalog/cart section |

Vocabulary goes in `shared/config.js` `LABELS` (resource, booking, slot) and the seed; the code stays generic.

**Health data**: for medical domains build the demo as a scheduler only. Don't collect diagnoses or other health details unless the user has said they will handle compliance (HIPAA/GDPR); say so in the summary. The same applies to payments: never store card numbers.

## A. Time-slot booking (template)

Tables `resources`, `bookings`. Hours in minutes since midnight in the resource timezone, slots on a grid of `slot_minutes`, 1..`max_slots` consecutive slots per booking. Overlap prevented by the exclusion constraint. Endpoints: resources, availability by date, create booking, list mine, cancel. Rules live in `shared/booking.js` + `shared/config.js`.

## Extension recipes (apply only what the domain needs)

1. **Different hours per weekday, lunch breaks, days off.** Add `resource_hours(resource_id, weekday smallint, open_min, close_min)` (several rows per weekday = breaks) and `resource_closures(resource_id, day date, reason)`. In `getAvailability`, take the weekday of `date` (`extract(isodow from $2::date)`), `generate_series` over each range, and mark slots on closure days unavailable. `checkSlotRange` then needs the day's ranges; load them in `createBooking` inside the transaction and keep the check in `db.js` (or pass the ranges into the shared function).
2. **Services with their own duration** (haircut 30, colouring 90). Add `services(id, name, minutes, price)`. The booking carries `service_id`; length = `minutes` rounded up to the grid instead of a user-chosen slot count. Price comes from the service. Snapshot service name and price into the booking. The exclusion constraint is unchanged.
3. **Capacity > 1** (classes, a bay with 4 lanes). The exclusion constraint no longer fits. Add `capacity` to the resource and in `createBooking` (resource row locked `FOR UPDATE`) `SELECT count(*) ... WHERE overlaps` and refuse at capacity. Keep the lock; it is what makes the count safe.
4. **Multi-day ranges** (rentals, hotel nights). Store `daterange(start_date, end_date, '[)')` and use an exclusion constraint on it for single units; for quantity, count overlapping rentals per item under the item lock. Price = nightly/daily rate x days from `shared/`.
5. **Peak / off-peak pricing.** Put the rule in `shared/booking.js` as a function `(resource, date, startMin, slots) -> price` and use it on both sides. Never let the browser send the price.
6. **Staff provider + room (two resources at once).** Insert one booking row per resource inside the same transaction; each has its own exclusion constraint, so either both succeed or the transaction rolls back.
7. **Accounts / sign-in: built in** (Better Auth, email + password). Extensions: *social login* (add `socialProviders` in `server/auth.js` with the provider's client id/secret in env, and a button calling `authClient.signIn.social`); *email verification / password reset* (needs an email provider, see 9; set `emailAndPassword.requireEmailVerification` and `sendResetPassword`/`sendVerificationEmail`); *roles* (Better Auth `admin` plugin, or a `role` additional field on `user`). If the app is purely public, remove `RequireAuth` and `requireUser` rather than leaving a login nobody needs.
8. **Admin view** (manage resources, see all bookings). Needs a role on the user (recipe 7). Put it under `/api/admin/*` behind a role check, not behind a hidden URL.
9. **Email/SMS confirmations, reminders.** Out of scope by default; add a provider (e.g. Resend) with the key in env, sent after the transaction commits, failures logged but not failing the booking.
10. **Real payments.** Use the provider's hosted checkout (Stripe Checkout) and confirm via signed webhook before marking `confirmed`; hold the slot as `pending` with an expiry meanwhile (extend the status CHECK and the exclusion `WHERE` to include `pending`). Never handle card numbers.

## B/C. Quantity and capacity

Same shape as the catalog pattern below: lock the row, count or decrement, snapshot, one transaction. Capacity for sessions = `stock` for products.

## D. Catalog + cart + checkout (the ShopEasy original)

Tables: `categories`, `products(id, name, category, price numeric(10,2), rating, stock CHECK >= 0, emoji, description)`, `orders(id, user_id, created_at, status, shipping jsonb, payment, subtotal, shipping_fee, tax, total)`, `order_items(order_id, product_id, name, emoji, price, qty, PK(order_id, product_id))` with name/emoji/price snapshotted. Index `orders (user_id, created_at DESC)`.

Shared: `pricing.js` `orderTotals(subtotal)` (free shipping threshold, flat fee, tax rate), `validation.js` (`SHIPPING_FIELDS`, `PAYMENT_METHODS`, `validateShipping`).

API: `GET /categories`, `GET /products`, `GET /products/:id`, `GET /orders` (signed-in user), `POST /orders {items:[{id,qty}], shipping, payment}`.

Frontend: `StoreContext` keeps cart and wishlist in state persisted via `storage.js`; cart lines store `{product, qty}` snapshots; Home has search, category chips, sort, price slider, in-stock filter; pages Cart, Checkout, Orders, Wishlist, ProductDetail. Checkout remembers the last address; passes only `{id, qty}`.

The core, which must be kept exactly as written:

```js
export async function createOrder({ userId, items, shipping, payment }) {
  return withTransaction(async (client) => {
    // Lock the rows being bought so two checkouts can't both take the last item.
    const { rows } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE', [items.map((i) => i.id)]);
    const products = new Map(rows.map((r) => [r.id, toProduct(r)]));
    const lines = items.map(({ id, qty }) => {
      const product = products.get(id);
      if (!product) throw new HttpError(400, `Product ${id} no longer exists`);
      if (qty > product.stock) throw new HttpError(409, product.stock === 0
        ? `${product.name} is out of stock` : `Only ${product.stock} ${product.name} left in stock`);
      return { product, qty };
    });
    const totals = orderTotals(lines.reduce((s, l) => s + l.product.price * l.qty, 0)); // DB prices
    // INSERT orders; per line: UPDATE products SET stock = stock - $qty; INSERT order_items snapshot
  });
}
```

`parseItems` in routes merges duplicate ids, caps lines (100) and qty (1000), and rejects non-integers. Scaffold the template for the infrastructure, delete the booking tables/pages, and port this pattern (the ShopEasy source, if still on disk, is the reference implementation).
