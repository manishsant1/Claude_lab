// Single entry point: serves the API and the React app from one process.
//   development  (npm run dev):   Vite runs inside Express with hot reload.
//   production   (npm start):     Express serves the prebuilt files in dist/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import apiRouter from './routes.js';
import * as db from './db.js';
import { auth, initAuth } from './auth.js';
import { LABELS } from '../shared/config.js';

const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const app = express();
app.disable('x-powered-by');
// Better Auth reads the raw request body itself, so it must be mounted BEFORE express.json().
// Express 5 needs the named wildcard (*splat).
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use('/api', express.json({ limit: '100kb' }), apiRouter);

if (isProd) {
  const dist = path.join(ROOT, 'dist');
  // Vite fingerprints everything in dist/assets, so those files can be cached for good.
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(dist, { index: false }));
  // Any other GET is a client-side route (e.g. /bookings), so send the app and let React Router handle it.
  // Paths with a file extension are missing files; answering them with HTML hides the real problem.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html'));
  });
} else {
  // Vite is a dev dependency and is only loaded here, so production installs don't need it.
  const { createServer } = await import('vite');
  // Import the config ourselves instead of letting Vite load it: Vite bundles the config into
  // a temporary file next to it, which file watchers see as a change, causing a restart loop.
  const { default: viteConfig } = await import('../vite.config.js');
  const vite = await createServer({
    ...viteConfig,
    configFile: false,
    root: ROOT,
    appType: 'spa',
    server: { middlewareMode: true, watch: { ignored: ['**/server/**'] } },
  });
  app.use(vite.middlewares);
}

try {
  await db.init();
  await initAuth();
} catch (err) {
  console.error('Could not start (database or auth setup failed):', err.message);
  process.exit(1);
}

const server = app.listen(PORT, () => {
  console.log(`${LABELS.appName} (${isProd ? 'production' : 'development'}) running at http://localhost:${PORT}`);
});

// Close database connections cleanly when the platform stops the app.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    db.close().finally(() => process.exit(0));
  });
}
