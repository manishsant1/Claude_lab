// Authentication with Better Auth (email + password, cookie sessions stored in Postgres).
// It shares db.js's Neon Pool, so there is one set of connections. Better Auth owns four tables
// (user, session, account, verification); `initAuth` creates them on start, like db.init does.
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { pool } from './db.js';

const PORT = process.env.PORT ?? 3000;

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error('BETTER_AUTH_SECRET must be set to a random string of at least 32 characters (see .env.example).');
  process.exit(1);
}

// Shared Neon database: prefix the table names so they can't collide with another app's
// `user` / `session` tables (and `IF NOT EXISTS` can't silently skip creating ours).
const P = '__DB_PREFIX__';

export const auth = betterAuth({
  database: pool,
  // Render sets RENDER_EXTERNAL_URL; elsewhere set BETTER_AUTH_URL to the public https URL.
  // It must match the address in the browser: Better Auth refuses cross-origin requests.
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${PORT}`,
  secret: process.env.BETTER_AUTH_SECRET,
  user: { modelName: P + 'user', deleteUser: { enabled: true } },
  session: { modelName: P + 'session' },
  account: { modelName: P + 'account' },
  verification: { modelName: P + 'verification' },
  // No email provider yet, so no verification mail and no password-reset mail (see archetypes.md).
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  // Behind a host's proxy every request would otherwise share one IP and one rate-limit bucket.
  advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
});

export async function initAuth() {
  const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(auth.options);
  if (toBeCreated.length || toBeAdded.length) {
    await runMigrations();
    console.log(`Auth tables ready (${toBeCreated.map((t) => t.table).join(', ') || 'updated'})`);
  }
}

