---
name: build-fullstack-app-react-node
description: Scaffold, verify and deploy a full-stack app (React + Vite frontend, Node/Express API, Neon Postgres, one process, one package) for any domain - booking apps such as tennis courts, doctor appointments, salon slots, equipment rentals, meeting rooms, or catalog/cart apps such as eCommerce. Use when the user asks to build, create, scaffold or deploy a web app, portal, booking/reservation/scheduling system, or "something like the eCommerce portal" for a new domain.
argument-hint: "<domain, e.g. tennis court booking>"
---

# Build a full-stack React + Node app

Turns a domain ("salon appointments", "meeting-room booking") into a running, verified, deployable app. It is distilled from the ShopEasy eCommerce portal, including the mistakes that were corrected along the way. Reuse the proven architecture; do not re-invent it.

**Stack (fixed unless the user says otherwise):** React 18 + Vite + react-router 6 · Express 5 · Neon Postgres via `@neondatabase/serverless` · Node >= 22.9 · plain CSS · one process serves API and UI · deploy on Render.

Files in this skill (read on demand, not all up front):

| Path | Use |
|---|---|
| `templates/app/` | A complete working **slot-booking** app (tennis-court data). The scaffold source. |
| `scripts/scaffold.mjs` | Copies the template and fills in names/vocabulary. |
| `references/learnings.md` | **Read before writing code.** Rules and past corrections. |
| `references/archetypes.md` | Mapping a domain to a design; extension recipes; the catalog/cart (eCommerce) pattern. |
| `references/deploy.md` | GitHub, Neon, Render, post-deploy checks. |
| `scripts/deploy-render.mjs` | One command: git, GitHub, Render service via API, wait for live, verify, smoke. |

## Workflow

### 1. Frame the request (ask little)

Work out from the request, and only ask about what you cannot infer or default:

- **Domain and nouns**: what is booked (resource: Court, Doctor, Stylist, Room, Item) and what the customer makes (Booking, Appointment, Reservation, Rental, Order).
- **Archetype**: time-slot booking, or catalog + cart + checkout? See `references/archetypes.md`. Slot booking is the default for courts, doctors, salons, rooms. Rentals by the day, tickets/seats or products need a variant; say which you chose and why.
- **App name** (propose one), **target folder** (default: a new folder named after the slug in the working directory; never scaffold into a non-empty folder).
- **Auth is built in** (Better Auth: email + password, cookie sessions in Postgres). Browsing is public; anything that creates or lists a person's records needs an account. Keep it unless the user says the app is public-only. Real payments, email (verification, password reset, confirmations), social login and an admin UI are **out of scope by default**: say so in the summary and offer them (recipes 7-9).

Use AskUserQuestion only for decisions that change the design (e.g. rentals: per-day or per-hour?). Otherwise decide, state the assumption, proceed.

### 2. Preflight

- `node -v` must be >= 22.9. If not, stop and tell the user.
- **Database**: the app needs a Neon `DATABASE_URL`. Ask the user to paste it or create `.env` themselves. Put it only in `.env` (git-ignored). Never echo it, commit it, write it to any other file, or put it in a command line that gets logged. If they have none yet: Neon console > New project > Connect > copy the connection string. Do not use another project's database for a test.
- **Auth secret**: `.env` also needs `BETTER_AUTH_SECRET` (32+ random characters). Generate it yourself and append it to `.env` without printing it (`node -p "require('crypto').randomBytes(32).toString('base64')"`); never reuse another app's secret. Production gets its own value (Render generates one from `render.yaml`).
- **Shared database**: if the database already serves another app, check its tables first (`information_schema.tables`). The template prefixes only the auth tables (`<slug>_user`, ...); also prefix your own tables (e.g. `<slug>_products`) when names such as `products`/`orders` exist, because `CREATE TABLE IF NOT EXISTS` silently skips a clashing name. Never run a test build against someone else's database without asking.
- Windows: check nothing is already on port 3000 (see learnings).

### 3. Scaffold

```
node "<skill dir>/scripts/scaffold.mjs" <target> --name "CourtBook" --resource "Court" --emoji 🎾
```

(`--resources` for irregular plurals, `--slug` to override the folder/package name.) The skill dir is the folder containing this file. Do not `git init` yet (step 7).

For the **catalog/cart** archetype, scaffold anyway for the infrastructure (server/index.js, dev.js, errors.js, api.js, storage.js, CSS, deploy files), then replace the booking domain using the pattern in `references/archetypes.md`.

### 4. Adapt to the domain

Edit in this order so each layer can be checked before the next:

1. `shared/config.js`: labels, currency, tax, advance window, cancel cutoff, per-user cap.
2. `server/seed.js`: realistic starter data for the domain (8+ rows is plenty, mixed categories, believable prices/hours). Resource times are minutes since midnight.
3. Schema in `server/db.js` + `shared/*`: add domain fields (e.g. doctor `specialty`, salon `services`) to the table, `toResource`, the seed insert and the forms. Apply an extension recipe from `references/archetypes.md` if the domain needs one (variable weekly hours, service durations, capacity, multi-day ranges).
4. `shared/validation.js` for the fields the customer must give (a clinic needs a reason for visit; a rental needs an ID/deposit note). Don't collect data you don't need.
5. UI copy and pages: wording comes from `LABELS`; rename routes/pages only if the domain demands it. Keep `src/api/api.js` as the only caller of the server.
6. `README.md` and `CLAUDE.md` in the project: update to match what you built (endpoints, tables, any new rules). Remove template sentences that no longer apply (e.g. "tennis").
7. Sweep: `grep -ri "tennis\|court" .` (or whatever the template domain was) and fix leftovers, including comments and the browser tab title.

Keep the invariants in `references/learnings.md`: server decides price and availability; the database enforces uniqueness; shared rules live in `shared/`; SQL only in `db.js`.

### 5. Verify (do not claim success without this)

1. `npm install`, then `npm run build` must pass.
2. Start the server (`npm run dev`, background) and wait for the "running at" line; if the DB connection fails, report the real error.
3. `npm run smoke` must pass. It signs up two throwaway users, checks 401s, ownership and the booking rules, then deletes the users. Extend it for every domain rule you add. Extend `scripts/smoke.mjs` for every domain rule you added (a new rule without a smoke check is untested).
4. Exercise the UI path that matters if a browser tool is available (home > pick > book > my bookings > cancel); otherwise say the UI was only build-verified.
5. Use `curl` from Bash on Windows, never PowerShell `Invoke-WebRequest`.
6. **Stop the dev server when done** and confirm the ports are free (learnings: Windows section).

Report exactly what was verified and what was not.

### 6. Review before shipping

Re-read the diff of anything you changed in `db.js`/`routes.js` against the checklist at the end of `references/learnings.md`. Remove dead code and stale comments left by the template.

### 7. Deploy (only when the user asks; confirm each outward step)

Run `scripts/deploy-render.mjs` as described in `references/deploy.md` (`--dry-run` first; ask once for the Render API key, a GitHub repo URL or token, and a card on the Render workspace). Otherwise follow `references/deploy.md` (it also covers deploying an app that was not scaffolded by this skill, and the post-deploy auth checks). Creating a GitHub repo, pushing, and creating or changing hosting resources are outward-facing: describe the exact action and get a yes first, every time. Never push `.env`. After deploy, run `BASE_URL=<url> npm run smoke` and report the URL.

If the user only said "build", stop after step 6 and offer to deploy.

### 8. Close out

Summarize in a few lines: what was built, where, how to run it, what is verified, what is deliberately missing (auth, payments), and the next sensible steps. If you learned something new and non-obvious during this build (a bug, a platform quirk, a correction from the user), add it to `references/learnings.md` so the next build benefits, and tell the user you did.
