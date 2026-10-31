# Learnings and corrections (from building ShopEasy)

Read before writing code. Each rule says why, because the reason tells you when it does not apply.

## Architecture

- **One package, one process.** Express serves `/api/*` and the React app. No separate frontend server, no CORS, same-origin `fetch('/api/...')`. Dev: Vite runs in Express middleware mode (HMR). Prod: Express serves `dist/` with an `index.html` fallback for client routes.
- **API mounted before the SPA fallback**, with its own JSON 404, so an unknown `/api/x` never returns HTML. The SPA fallback only answers GETs without a file extension; a missing `/assets/x.js` must 404, not return HTML (that produces baffling "wrong MIME type" errors after a redeploy).
- **`shared/` is imported by both server and browser** (pricing, validation, booking rules, config). The two can never disagree about a rule. Keep it dependency-free, plain ES modules. The frontend imports it as `../../shared/...`.
- **SQL lives only in `server/db.js`.** Routes validate and call db functions; they never build queries.
- **Express 5** forwards thrown errors (sync and async) to the error handler, so handlers just `throw new HttpError(status, message, details)`. `HttpError` thrown inside a transaction also rolls it back. Error JSON shape is always `{ error, details }`; `details` is a per-field map the form displays.
- **Close the pool on SIGINT/SIGTERM** so hosts can stop the app cleanly.

## Data and correctness

- **Never trust the client for money or availability.** The client sends only what the user chose (ids, quantities, date/time). The server loads the rows, reprices, checks stock/availability, and ignores any price or total in the request. The browser may show an estimate using the same `shared/` function.
- **Core operation = one transaction**: lock the row(s) (`SELECT ... FOR UPDATE`, ordered by id to avoid deadlocks), validate, insert, decrement/claim. Two checkouts must not both take the last item.
- **Let the database enforce uniqueness.** For time slots use a Postgres exclusion constraint (`btree_gist`, `tstzrange(...) WITH &&`, `WHERE status = 'confirmed'`); map error code `23P01` to HTTP 409. Application-level "check then insert" alone is a race. For counted stock use `CHECK (stock >= 0)` plus the locked decrement.
- **Snapshot what must not change retroactively** (name, emoji, price, timezone) into the order/booking row, so editing the catalog does not rewrite history.
- **`numeric` comes back as a string** from Postgres. Convert with `Number()` in the row mappers (`toProduct`, `toBooking`), once, in `db.js`. Return camelCase from the API.
- **Time**: store instants as `timestamptz`. Business hours are wall-clock in the resource's timezone, kept as integer minutes since midnight. Let Postgres convert (`(date + make_interval(mins => m)) AT TIME ZONE tz`) so DST is right and no date library is needed. Format on the client with `Intl.DateTimeFormat` and the resource's `timeZone`. Parse `YYYY-MM-DD` as UTC and format as UTC so the viewer's timezone cannot shift the day. Compute "today" with `Intl` in the resource's timezone, not the server's.
- **Schema**: idempotent `CREATE ... IF NOT EXISTS` run at every start; seed only when the main table is empty. There is no migration tool: changing an existing table needs a manual `ALTER` on the real database *and* the same change in `SCHEMA`. Tell the user when a change needs one.
- **Start on the real database from day one.** ShopEasy began on a JSON file and was migrated to Neon later; the migration left stale comments ("copied into the data file"), an unused `data/` folder and a `.gitignore` entry behind. Don't build file persistence "for now".
- **Identity comes from the session, never from the request body.** `requireUser` (routes.js) turns the Better Auth cookie into `user.id`; every query for a person's records filters by it. Cap active bookings/orders per user (accounts are free to create, so the cap limits hoarding, not abuse), and return 404 (not 403) for another user's record so existence is not leaked.
- **Validate everything at the edge**: types, integer ranges, array lengths, body size (`express.json({limit:'100kb'})`), string lengths. A JSON body can send `null` where you expect an object, and a default parameter does not catch `null`.

## Frontend

- **`src/api/api.js` is the only module that calls the server.** It throws `ApiError {status, details}`, and turns network failures into a friendly message.
- **`crypto.randomUUID` only exists on HTTPS/localhost**; keep the fallback so a plain-HTTP deployment does not crash.
- **localStorage access is wrapped** (`storage.js`, try/catch, namespaced prefix) because private mode and quota errors throw.
- **Client-held snapshots go stale** (cart lines store a product copy, so stock/price can be out of date). The server is the authority at submit; surface its 409 message and let the user fix it.
- **After a successful submit, don't reset `submitting`** and navigate away with the server's result. Checkout guards `cart.length === 0 && !submitting`: clearing the cart on success otherwise bounces the user to /cart before the navigation lands. On failure, reset and show the message.
- **Effects that fetch on user input need an `off` flag** in cleanup so a slow, older response cannot overwrite a newer one (date pickers, filters).
- Always render three states: loading, error (the real message), empty.
- Form errors: per-field from `details`, plus a banner message. `noValidate` on the form and validate with the shared function.
- Mobile: breakpoints at 800px and 560px; grids collapse to one or two columns.

## Windows (this user's machine)

- **`node --watch` / `--watch-path` loops forever**, reacting to Vite writing `node_modules/.vite/deps_temp_*`. Use the template's `server/dev.js` (fs.watch on `server/` and `shared/`, `.js` only, debounced). Vite's own config loader also writes a temp `vite.config.js.timestamp-*.mjs`, so `server/index.js` imports the config itself and passes `configFile: false`. Don't "simplify" either.
- **Stopping a background `npm run dev` leaves orphan node processes** holding port 3000 and Vite's HMR port 24678. Starting again then fails with "Port is already in use". Before every start and after every test run: find and kill them, then confirm the ports are free:
  `Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'server[\\/](index|dev)\.js' } | % { Stop-Process -Id $_.ProcessId -Force }` then `Get-NetTCPConnection -LocalPort 3000,24678 -ErrorAction SilentlyContinue`.
  (Match the path with `[\\/]`: the child process path uses backslashes.) Only kill processes you started.
- **PowerShell `Invoke-WebRequest` to localhost can hang.** Use `curl` from Bash.
- Writing outside the project or the scratchpad (e.g. the drive root) is denied; use the scratchpad for scratch work.
- Shell quoting: build files with the Write/Edit tools, not nested `node -e`/heredoc quoting.

## Secrets and repo hygiene

- The connection string lives **only** in `.env` (git-ignored, with `.env.example` committed). ShopEasy keeps a `postgressconnectionstring.txt` in the project root that its `.gitignore` does not cover; one `git add .` after `git init` would publish the database password. Never create such files. The template's `.gitignore` also blocks `*connectionstring*` and `*secret*`.
- Never print `.env` contents, put secrets in command lines, or paste them into docs, READMEs or chat.
- Before the first commit run `git status` and look at what will be added.
- Don't commit `dist/`, `node_modules/`, screenshots of the dev machine, or scratch files.

## Deploy

- Build needs devDependencies (Vite). Hosts that set `NODE_ENV=production` skip them with `npm ci`/`npm install`, so the build command must be `npm install --include=dev && npm run build`.
- Health check path `/api/health` (it pings the DB, so it also proves the connection string works).
- Free tiers sleep (Render) and scale to zero (Neon); the first request after idle can take several seconds. That is not a bug; say so.
- Details in `deploy.md`.

## Process

- Build -> run -> **smoke** -> report. "It compiles" is not "it works". State what was and was not verified.
- When a rule is added, add a smoke check for it in the same change.
- Update the project's `README.md` and `CLAUDE.md` whenever architecture, endpoints or schema change, so the next session starts with the truth.
- Keep comments to the non-obvious *why* (the ShopEasy code comments are the model: a race, a platform quirk, a decision). Delete template comments that no longer apply.

## Pre-ship checklist

- [ ] Prices/availability come from the DB; request totals ignored (smoke covers it)
- [ ] Uniqueness enforced by a DB constraint, mapped to 409
- [ ] Core write is one transaction with row locks
- [ ] All request fields validated; `null`/wrong types do not 500
- [ ] Other users' records return 404; per-user caps exist; unauthenticated writes return 401
- [ ] No secrets in repo, README or logs; `.env` ignored
- [ ] No leftover template wording (`grep` the template domain)
- [ ] `npm run build` and `npm run smoke` pass; dev server stopped, ports free
- [ ] README/CLAUDE.md match the code

## Added from the SkyBook (airline) build

- **A Postgres parameter can't be used with two types.** `$1::text AS date` next to `$1::date` fails with "inconsistent types deduced for parameter". Use `$1::date::text`.
- **Capacity (seats, stock) has no uniqueness constraint to lean on**: lock the parent row `FOR UPDATE`, then `sum()` the confirmed claims in the same transaction. Smoke it by filling the resource with several client ids and racing two requests for the last seats (expect one 201, one 409).
- **Select `date` columns as text** (`flight_date::text`); node-pg turns `date` into a local-time `Date` that can shift the day.
- **Port 24678 (Vite HMR) may be held by another project's dev server.** Don't kill it; verify with `npm run build && npm start` (no Vite) instead.

## Added from adding Better Auth

- **Mount order**: `app.all('/api/auth/*splat', toNodeHandler(auth))` goes **before** `express.json()`; Better Auth reads the raw body, and a parsed body makes its endpoints hang. Express 5 needs the named wildcard (`*splat`); `/api/auth/*` is Express 4 syntax.
- **One pool**: pass db.js's Neon `Pool` as `database` (Better Auth wraps it with Kysely's pg dialect). Run `getMigrations(auth.options)` + `runMigrations()` at start (`initAuth`) instead of the CLI, to match the "schema created on every start" rule.
- **Prefix its tables** (`modelName`) when the database is shared; the defaults `user`/`session`/`account`/`verification` are likely to collide.
- **Public URL must match the browser's address**: Better Auth rejects cross-origin writes using `baseURL`/`trustedOrigins`. Locally it defaults to localhost:PORT; on Render use `RENDER_EXTERNAL_URL`; elsewhere set `BETTER_AUTH_URL`. A custom domain needs `BETTER_AUTH_URL` set to it.
- **Secret**: `BETTER_AUTH_SECRET` is required and differs per environment. Changing it signs everyone out.
- **Behind a proxy** set `advanced.ipAddress.ipAddressHeaders: ['x-forwarded-for']`, or all users share one rate-limit bucket (rate limiting is on by default in production).
- **Client calls return `{ data, error }`** rather than throwing; `src/api/auth.js` unwraps them. Gate pages with `RequireAuth` and pass the intended location in router state so the user lands back where they were.
- **Harmless first-start log**: "Database schema mismatch ... Missing tables" appears once on a fresh database because Better Auth checks before `initAuth` migrates; the next line confirms the tables were created.
- **Verified on FreshCart** (catalog/cart, Neon + this auth.js, prefix `grocery_`): sign-up, sessions, 401/404 ownership, sign-out/in and account deletion all pass the smoke test. Renaming an existing `client_id` column to `user_id` on a live table needs a manual `ALTER` (no migration tool).
- **Smoke test cookies**: Node's fetch has no cookie jar; the smoke script keeps its own and sends an `Origin` header equal to the base URL for writes.
- **Test builds stay out of other people's databases.** Verify the template against a database you were told to use, check existing table names first, and drop only what you created.

## Added from retrofitting auth onto SkyBook (anonymous `client_id` -> Better Auth)

- **Retrofit recipe**: copy `server/auth.js` (replace `__DB_PREFIX__`), `src/api/auth.js`, `RequireAuth.jsx`, `Login.jsx` and the `/* Auth */` CSS; mount `toNodeHandler(auth)` before `express.json()`; swap `requireClientId` for async `requireUser` (remember `await` at every call site); `initAuth()` after `db.init()`; add `BETTER_AUTH_SECRET` to `.env`, `.env.example` and `render.yaml`.
- **Rename the owner column in place** with an idempotent `DO $$ ... ALTER TABLE ... RENAME COLUMN` block placed in `SCHEMA` before the index that uses the new name, and drop the old index. Old anonymous rows stay but belong to no account; say so.
- **Never write SQL `$$` through a bash `node -e "..."`/heredoc edit**: double quotes collapse `$$` to the shell PID/`$` and Postgres reports `syntax error at or near "$"`. Use the Edit tool for any file containing `$`. Same for big rewrites of scripts: use Write.
- **A bulk rename can miss a template-string use** (`${MAX_..._PER_CLIENT}` in an error message gave a runtime ReferenceError -> 500 only on the cap path). `grep` for the old name afterwards, and smoke the cap path.
- **Smoke with accounts**: the per-user cap means the fill-the-flight loop must rotate filler accounts; sign-up and delete-user in `finally` so a failed run leaves no accounts or seats behind.

## Added from the SkyBook Render deployment

- **Deploying is scripted**: `scripts/deploy-render.mjs` (see `deploy.md`). It was written from a session that needed four round trips with the user: no `gh` CLI, an expired GitHub login, a Render workspace with no card (HTTP 402), and a second API key for a different workspace. Ask for everything once, up front: Render key, an empty GitHub repo URL (or a token), a card on the Render workspace.
- **Never pull Git's stored credential yourself** (`git credential fill`) to call the GitHub API: the permission check refuses it as credential access. Use `--repo` with a repo the user created, `GITHUB_TOKEN`, or `gh`. A plain `git push` is fine and lets Git Credential Manager prompt.
- **Check which Render workspace a key belongs to** before creating anything; it can be a different account with unrelated services. Report it, and never modify services you did not create.
- **Production rate limits** (Better Auth: a few sign-ups per 10 s) make a naive smoke test fail with 429. Retry after the window; never weaken the production limit.
