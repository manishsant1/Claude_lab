# Deploying: GitHub + Neon + Render

The template deploys as **one Render web service** (API + built UI) backed by **Neon Postgres**. Nothing is stored on local disk, so any Node 22.9+ host works with the same two commands:

- Build: `npm install --include=dev && npm run build`
- Start: `npm start`
- Env: `DATABASE_URL` and `BETTER_AUTH_SECRET` (both required), `BETTER_AUTH_URL` (the public https URL; Render supplies `RENDER_EXTERNAL_URL` automatically), `PORT` (host sets it), health check `/api/health`

## Automated deploy (default path): `scripts/deploy-render.mjs`

One command does git, GitHub, the Render service, waiting for "live", and verification. It is idempotent (reuses the remote, commit and Render service), prints no secret, and stops with an exact instruction when it needs the user. Verified end to end on SkyBook (existing-service path; the create path was run step by step by hand with the same API calls).

```
cd <project>
RENDER_API_KEY=rnd_...  [GITHUB_TOKEN=...]  node "<skill dir>/scripts/deploy-render.mjs" \
  [--repo https://github.com/<user>/<repo>.git] [--name <service>] [--region ohio] [--owner <id>] \
  [--message "<commit message + attribution trailer>"] [--public] [--skip-smoke] [--dry-run]
```

**What the user must provide (ask once, up front, in one message):**

| Need | Why | How it is passed |
|---|---|---|
| Render API key | creates the service | `RENDER_API_KEY` env var for that one command; never written to a file |
| A GitHub repo: an **empty repo URL** they created, **or** a `GITHUB_TOKEN` that can create repos | Render deploys from git; `gh` is often missing, and reading Git's stored credential to create the repo yourself is refused as credential access | `--repo <url>` or `GITHUB_TOKEN` env var |
| A card on the Render workspace | Render's API returns 402 "Payment information is required" for any web service, free plan included | user adds it at dashboard.render.com/billing |
| `DATABASE_URL` in `.env` | copied to Render server-side from the file, never printed | already in `.env` |

The user's "deploy it" / "complete the entire process yourself" is the authorization for the git, GitHub and Render actions below; still state the plan first (repo, service name, region, workspace, env var *names*). Run `--dry-run` first: it checks the key, shows the workspace and whether the service exists, and runs the build, without any outward action.

**What it does, in order**
1. Preflight: `RENDER_API_KEY`, `.env` with `DATABASE_URL`, `npm run build` passes, Neon region shown (Render region should match: us-east-2 -> `ohio`).
2. Render: `GET /owners`. It prints the workspace name and email; **confirm it is the account the user means**. A key can belong to another account with unrelated services; never touch those. Stops if the key sees several workspaces (pass `--owner`).
3. Git: `git init -b main` if needed; refuses if `.env`, `node_modules`, `dist` or `*secret*`/`*connectionstring*` files are tracked or staged; commits pending changes.
4. GitHub: uses `--repo`, else the existing `origin`, else creates a private repo (`GITHUB_TOKEN`, then authenticated `gh`), else stops and tells you what to ask the user for. Pushes with `-c http.sslBackend=schannel` on Windows (Git's OpenSSL fails with "unable to get local issuer certificate"). It does not set `GIT_TERMINAL_PROMPT=0`: when the stored login has expired ("Invalid username or token"), Git Credential Manager must be able to open its browser sign-in, which is how the SkyBook push succeeded after the first rejection.
5. Render service: `POST /v1/services` (web_service, node, free plan, `autoDeploy: yes`, `healthCheckPath: /api/health`, build `npm install --include=dev && npm run build`, start `npm start`, env `NODE_VERSION=22`, `DATABASE_URL`, `BETTER_AUTH_SECRET` generated). Skipped if a service with that name exists in the workspace (the push redeploys it).
6. Polls the deploy until `live` (about 1 minute; fails fast on `build_failed` etc.).
7. Verifies: `/api/health` is `{"ok":true}`, `/bookings` deep link is 200, `/assets/x.js` is 404, then `BASE_URL=<url> npm run smoke` (the template smoke retries sign-up on Better Auth's production 429 rate limit).
8. Prints the URL, service id, repo and workspace. Then: record them in the project's CLAUDE.md, and **tell the user to rotate any key they pasted into chat**.

**Failures and the exact next step**

| Output | Meaning | Action |
|---|---|---|
| `STOP: RENDER_API_KEY is not set` | no key | ask for one |
| HTTP 402 / "Payment information is required" | no card on workspace | user adds a card, rerun |
| `No way to create the GitHub repo` | no `--repo`, token or `gh` | ask for an empty repo URL or a token |
| `git push failed` (auth) | stored GitHub login expired | rerun so GCM can prompt; or `GITHUB_TOKEN` |
| Render creation fails mentioning repository access | Render account not connected to that GitHub repo | user installs the Render GitHub app for it, or makes the repo public |
| `Deploy build_failed` | build error on Render | read the log in the dashboard link; most often `--include=dev` missing |
| smoke 429 | rate limit | the template retries; on an old project copy the retry from the template `scripts/smoke.mjs` |

The manual steps below remain as the reference for what the script does and for hosts other than Render.

## Rules for the agent

- Creating a repo, pushing, creating services, and setting env vars are **outward-facing**: say exactly what you will do and wait for a yes before each. Approval for one app does not carry to the next.
- Never put `DATABASE_URL` in git, a command line, a file other than `.env`, or your reply. For hosts, the user sets it in the dashboard (`sync: false` in `render.yaml`), or you use the host's CLI with the value read from the environment, not typed.
- Don't claim the app is deployed until `/api/health` returns `{"ok":true}` on the public URL and the smoke test passes against it.

## Steps

1. **Local sanity**: `npm run build` and `npm run smoke` passed; dev server stopped.
2. **Git**: `git init -b main`, `git status` and read the list (no `.env`, no `node_modules`, no stray secret files), then commit (`Initial commit`, with the attribution trailer from the session instructions if present).
3. **GitHub** (if `gh auth status` is OK and the user agrees): `gh repo create <slug> --private --source . --push`. Default to private. If `gh` is missing, give the user the three commands (`git remote add origin ...`, `git push -u origin main`) rather than installing tools.
4. **Neon**: the same project/database used locally is fine for a first deploy. Better: a separate branch/database for production so test bookings stay out (Neon console > Branches). The user supplies the connection string. The schema and seed are created by the app on first start.
5. **Render**: New > Blueprint > pick the repo (reads `render.yaml`) > set `DATABASE_URL`. `BETTER_AUTH_SECRET` is generated by the blueprint. If you add a custom domain, also set `BETTER_AUTH_URL` to it. Region should be near the Neon region. Wait for "Live".
6. **Verify the deployment**:
   ```
   curl -s https://<service>.onrender.com/api/health
   BASE_URL=https://<service>.onrender.com npm run smoke
   ```
   Then load `/`, a deep link (e.g. `/bookings`, must serve the app, not 404) and a missing asset (`/assets/x.js` must 404).
7. Report the URL, what ran, and what the smoke test covered.

## Gotchas

- **Vite is a devDependency**; with `NODE_ENV=production` plain `npm ci`/`npm install` skips it and the build fails with "vite: not found". Keep `--include=dev` in the build command.
- **Cold starts**: Render's free plan sleeps after ~15 minutes idle and Neon suspends idle compute, so the first request can take 10-30 s. Say so; a paid plan or an uptime ping removes it. `db.init()` runs before listening, so the health check passes only once the DB answers.
- **Smoke accounts and bookings in production** are real rows. The smoke test cancels its bookings and deletes its two accounts, but prefer pointing it at a staging/branch database.
- **Schema changes after launch** need a manual `ALTER` in the Neon SQL editor before deploying code that uses them (no migration tool).
- **Node version**: `engines` requires >= 22.9; `render.yaml` sets `NODE_VERSION=22`.
- **Custom domain / HTTPS**: Render provides HTTPS; add the domain in the dashboard. Auth cookies are marked Secure automatically on https URLs.
- **Other hosts**: Railway/Heroku-style buildpacks work with the same commands. Fly.io needs a Dockerfile (`FROM node:22-slim`, `npm install --include=dev`, `npm run build`, `npm prune --omit=dev`, `CMD ["npm","start"]`); create it only if asked.
- **Rollback**: Render keeps previous deploys (Manual deploy > pick a commit). Data changes are not rolled back by that.

## Deploying an existing app (not scaffolded by this skill)

Check these before step 2; each one has bitten a real deploy.

- **Not a git repo yet** (e.g. SkyBook): `git init -b main`, confirm `.gitignore` covers `.env`, `node_modules`, `dist`, `*secret*`, `*connectionstring*`, then `git status` and read it. No remote yet means step 3 is `gh repo create <slug> --private --source . --push`; ask first.
- **`render.yaml` must match the code**: `buildCommand` with `--include=dev`, `healthCheckPath: /api/health`, `NODE_VERSION: 22`, `DATABASE_URL` with `sync: false`, and `BETTER_AUTH_SECRET` with `generateValue: true`. The `name` becomes the URL (`https://<name>.onrender.com`); pick one that is free.
- **Pre-auth data**: if the database still has rows keyed by an old anonymous `client_id`, the first start renames the column to `user_id` (see learnings). Those rows belong to no account. For production prefer a fresh Neon branch.
- **Production database**: do not point production at the dev database by default. Ask whether to create a Neon branch; the user provides the connection string, entered in the Render dashboard (never in chat, a file or a command line).
- **Region**: choose the Render region nearest the Neon region (shown in the Neon connection string host, e.g. `us-east-2`).

## Doing it from the terminal vs the dashboard

- **Script (default when the user will give an API key)**: `scripts/deploy-render.mjs`, above. It reads `DATABASE_URL` from `.env` itself, so the user never has to paste the database string.
- **Dashboard (fallback when the user prefers not to share a key)**: New > Blueprint > pick the repo > enter `DATABASE_URL`. Needs no tooling, and the user keeps every secret out of the session.
- **Render CLI**: only if the user already has it installed and authenticated (`render whoami`). Never install tools. Never pass `DATABASE_URL` as a command-line argument.
- Don't *ask* for a key to be pasted into chat if the dashboard works for them, but if they offer one and tell you to proceed, use it via the environment only and remind them to rotate it afterwards.
- Auto-deploy on push is on by default for Blueprint services; mention that every push to `main` redeploys.

## Post-deploy checks for apps with auth

1. `curl -s https://<service>.onrender.com/api/health` returns `{"ok":true}` (the first call can take 30 s on the free plan).
2. Sign up in the browser, reload (the session must survive), sign out, sign in again. If sign-up fails with a cross-origin / "Invalid origin" error, `BETTER_AUTH_URL` / `RENDER_EXTERNAL_URL` does not match the address in the browser (custom domain?).
3. `BASE_URL=https://<service>.onrender.com npm run smoke`. In production Better Auth turns rate limiting on, and the smoke test signs up several accounts in a few seconds. If it fails with 429, wait ten seconds and rerun, or run it against a staging service; do not weaken the production limits to make the test pass. Verified on SkyBook: the unmodified smoke test got 429 on the third sign-up; the template's `newUser` now waits 11 s and retries on 429, after which every check passed on Render.
4. A deep link such as `/bookings` serves the app, and `/assets/x.js` returns 404.
5. Report the URL, the commit deployed, and which checks passed. State plainly any that were skipped.

Do not call the app deployed until 1 and 3 pass.

## Deploying through the Render API (verified on SkyBook)

`POST https://api.render.com/v1/services` with `Authorization: Bearer <key>`. Get `ownerId` from `GET /v1/owners` (check the owner/email is the one the user means; a key can belong to a different workspace that already has unrelated services, which must be left untouched). Body: `type: web_service`, `name`, `ownerId`, `repo` (https URL, no `.git`), `branch`, `autoDeploy: "yes"`, `serviceDetails: { runtime: "node", plan: "free", region, healthCheckPath, envSpecificDetails: { buildCommand, startCommand } }`, `envVars: [{key, value}, {key: "BETTER_AUTH_SECRET", generateValue: true}]`. Build the JSON with `node --env-file=.env` and pipe it to `curl -d @-` so `DATABASE_URL` never appears in a command line or file. Poll `GET /v1/services/<id>/deploys/<deployId>` until `status` is `live` (about 1 minute).

- Creating a service returns *"Payment information is required"* until the workspace has a card on file, even for the free plan. The user must add it in the dashboard.
- Pick the Render region nearest Neon (`us-east-2` -> `ohio`).
- On Windows, Git's OpenSSL may fail with "unable to get local issuer certificate"; push with `git -c http.sslBackend=schannel push`. If the stored login is rejected, a plain push lets Git Credential Manager re-authenticate. Never read the stored credential yourself.
- A key pasted into chat is exposed: tell the user to rotate it after the deploy.
