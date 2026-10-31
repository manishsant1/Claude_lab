# __APP_NAME__

A booking app: React + Vite frontend and a Node.js + Express API, run as **one process from one package**, with data stored in **Neon serverless Postgres**.

## Run

1. Create a Neon project at https://console.neon.tech and copy its connection string (Connect button).
2. Copy `.env.example` to `.env`, set `DATABASE_URL` to that string and `BETTER_AUTH_SECRET` to a random 32+ character value (the file shows a one-line command to generate one).
3. Start the app:

```
npm install
npm run dev          # development: http://localhost:3000, with hot reload
```

On first start the server creates the tables and loads the starter data.

```
npm run build        # builds the frontend into dist/
npm start            # serves the API and the built app on http://localhost:3000
npm run smoke        # API checks against the running server (BASE_URL=... to target a deployment)
```

## Deploy (Render + Neon)

1. Push this folder to a GitHub repository (`.env` is git-ignored).
2. In Render choose **New > Blueprint**, pick the repository; `render.yaml` defines the service.
3. Set `DATABASE_URL` (your Neon connection string) when prompted.
4. After the first deploy: `BASE_URL=https://<your-service>.onrender.com npm run smoke`.

Any host that runs Node 22.9+ works: the build is `npm install --include=dev && npm run build` and the start command is `npm start`. The app keeps no data on local disk. Render's free plan sleeps after inactivity, so the first request after a pause is slow.

| Variable       | Default         | Purpose                          |
|----------------|-----------------|----------------------------------|
| `DATABASE_URL` | none (required) | Neon Postgres connection string  |
| `BETTER_AUTH_SECRET` | none (required) | Signs session cookies, 32+ characters |
| `BETTER_AUTH_URL` | `RENDER_EXTERNAL_URL`, else `http://localhost:PORT` | Public URL; set it on hosts other than Render |
| `PORT`         | `3000`          | HTTP port (set by most hosts)    |

## How it fits together

```
server/
  index.js    Entry point. API at /api; dev: Vite inside Express; prod: serves dist/
  dev.js      Dev runner: restarts index.js when server/ or shared/ code changes
  routes.js   API endpoints and request validation
  db.js       All SQL: schema, queries, the booking transaction
  seed.js     Starter data, loaded into an empty database
shared/       Rules used by both browser and server (config, booking, validation)
src/
  api/api.js  The only place the frontend calls the server
  pages/      Home, ResourceDetail, Book, Bookings
```

### API

| Method | Path                                | Notes                                              |
|--------|-------------------------------------|----------------------------------------------------|
| GET    | `/api/health`                       | Health check                                       |
| GET    | `/api/categories`                   |                                                    |
| GET    | `/api/resources`                    |                                                    |
| GET    | `/api/resources/:id`                | 404 if not found                                   |
| GET    | `/api/resources/:id/availability?date=YYYY-MM-DD` | Slots with `available` / `taken` / `past` |
| GET    | `/api/bookings`                     | The caller's bookings (sign-in required)          |
| POST   | `/api/bookings`                     | `{ resourceId, date, startMin, slots, customer }`  |
| POST   | `/api/bookings/:id/cancel`          | Owner only; not within the cancellation cutoff     |

Double-booking is prevented by a database exclusion constraint, so it holds even when requests race. Prices come from the database, never from the browser.

Accounts use [Better Auth](https://www.better-auth.com) (email + password, cookie sessions; its endpoints live under `/api/auth/*`). Browsing is public; booking, listing and cancelling need an account, and you only ever see your own bookings. There is no email verification or password reset yet (that needs an email provider).

To reset the data, drop the tables in the Neon SQL editor and restart (the server recreates and reseeds them):

```sql
DROP TABLE bookings, resources;
```
