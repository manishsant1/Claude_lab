// One-command deploy: git -> GitHub -> Render (API) -> wait for live -> verify. Run it from the
// project folder. It encodes the sequence that worked for SkyBook; see references/deploy.md.
//
//   RENDER_API_KEY=rnd_... node <skill>/scripts/deploy-render.mjs [options]
//
// Secrets come only from the environment (RENDER_API_KEY, optional GITHUB_TOKEN) and the project's
// .env (DATABASE_URL). Nothing secret is printed, written to a file or put on a command line.
// Every run is idempotent: re-running reuses the remote, the commit and the Render service.
//
// Options
//   --repo <https url>   GitHub repo to push to (an empty repo the user created). Without it the
//                        script creates one (GITHUB_TOKEN, else the `gh` CLI), else it stops.
//   --public             create the repo public (default private)
//   --name <name>        Render service + GitHub repo name (default: package.json name)
//   --region <region>    Render region (default: ohio; choose the one nearest Neon, e.g. us-east-2 -> ohio)
//   --owner <id>         Render owner id (needed only when the key sees several workspaces)
//   --message <text>     commit message (default "Deploy to Render"); include the session's trailer
//   --skip-smoke         do not run `npm run smoke` against the live URL
//   --dry-run            print the plan and run no outward action
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const DRY = flag('dry-run');
const log = (...a) => console.log(...a);
const die = (msg, code = 1) => { console.error(`\nSTOP: ${msg}`); process.exit(code); };

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const NAME = opt('name', pkg.name);
const REGION = opt('region', 'ohio');
const RENDER = process.env.RENDER_API_KEY;
const GH_TOKEN = process.env.GITHUB_TOKEN;

// npm is npm.cmd on Windows, which Node only spawns through a shell; pass one fixed string then.
function run(cmd, cmdArgs, { quiet = false } = {}) {
  const r = cmd === 'npm' && process.platform === 'win32'
    ? spawnSync(['npm', ...cmdArgs].join(' '), { encoding: 'utf8', shell: true })
    : spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (!quiet && r.stdout?.trim()) log(r.stdout.trim());
  return r;
}
// Git over https on Windows: Git's bundled OpenSSL often cannot find the CA store
// ("unable to get local issuer certificate"). schannel uses Windows' own store; verification stays on.
const gitNet = (a) => run('git', [...(process.platform === 'win32' ? ['-c', 'http.sslBackend=schannel'] : []), ...a]);

// --- 0. Preflight -------------------------------------------------------------------------------
log(`Deploying "${NAME}" (region ${REGION})${DRY ? ' [dry run]' : ''}`);
if (!RENDER) die('RENDER_API_KEY is not set. Ask the user for a Render API key and pass it as an environment variable for this one command; never write it to a file.');
if (!existsSync('.env')) die('.env not found; DATABASE_URL is read from it.');
const envText = readFileSync('.env', 'utf8');
const dbUrl = /^DATABASE_URL=(.+)$/m.exec(envText)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!dbUrl) die('DATABASE_URL is missing from .env.');
const region = /\.([a-z]{2}-[a-z]+-\d)\.aws\.neon\.tech/.exec(dbUrl)?.[1];
log(`Neon region: ${region ?? 'unknown'} (Render region ${REGION}; Ohio = us-east-2, Oregon = us-west-2, Frankfurt = eu-central-1, Singapore = ap-southeast-1)`);

const bld = run('npm', ['run', 'build'], { quiet: true });
if (bld.status !== 0) die('`npm run build` failed; fix it before deploying.\n' + (bld.stdout + bld.stderr).slice(-800));
log('Build OK');

async function api(base, path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const render = (path, o = {}) => api('https://api.render.com/v1', path, { ...o, token: RENDER });

// --- 1. Render account: key works, which workspace, any card on file ---------------------------
const owners = await render('/owners?limit=20');
if (owners.status !== 200) die(`Render rejected the API key (HTTP ${owners.status}).`);
let ownerList = owners.data.map((o) => o.owner);
const wanted = opt('owner');
if (wanted) ownerList = ownerList.filter((o) => o.id === wanted);
if (ownerList.length !== 1) {
  die(`Render key sees ${ownerList.length} workspaces; pass --owner <id>:\n` + ownerList.map((o) => `  ${o.id}  ${o.name}  ${o.email}`).join('\n'));
}
const owner = ownerList[0];
// A key can belong to a different account than the user expects, with unrelated services in it.
// Report it so the agent can confirm; never modify a service that is not ours.
log(`Render workspace: ${owner.name} <${owner.email}> (${owner.id})`);
const existing = (await render(`/services?name=${encodeURIComponent(NAME)}&ownerId=${owner.id}&limit=5`)).data
  ?.map((s) => s.service).find((s) => s.name === NAME);

// --- 2. Git: repo, commit ------------------------------------------------------------------------
if (!existsSync('.git')) { if (!DRY) run('git', ['init', '-b', 'main']); log('git init'); }
const tracked = run('git', ['ls-files'], { quiet: true }).stdout.split('\n');
const bad = tracked.filter((f) => /(^|\/)\.env($|\.(?!example))|^node_modules\/|^dist\/|secret|connectionstring/i.test(f) && f !== '.env.example');
if (bad.length) die('These files are tracked and must not be committed:\n  ' + bad.join('\n  '));
const dirty = run('git', ['status', '--porcelain'], { quiet: true }).stdout.trim();
if (dirty) {
  if (DRY) log('Would commit:\n' + dirty);
  else {
    run('git', ['add', '-A']);
    const staged = run('git', ['diff', '--cached', '--name-only'], { quiet: true }).stdout.split('\n');
    const leaked = staged.filter((f) => /(^|\/)\.env($|\.(?!example))|^node_modules\/|secret|connectionstring/i.test(f) && f !== '.env.example');
    if (leaked.length) { run('git', ['reset']); die('Refusing to commit: ' + leaked.join(', ')); }
    const c = run('git', ['commit', '-q', '-m', opt('message', 'Deploy to Render')]);
    if (c.status !== 0) die('git commit failed (is user.name / user.email set?)\n' + c.stderr);
    log('Committed');
  }
}

// --- 3. GitHub: remote, create if needed, push ----------------------------------------------------
let repoUrl = opt('repo');
const origin = run('git', ['remote', 'get-url', 'origin'], { quiet: true });
const currentOrigin = origin.status === 0 ? origin.stdout.trim() : null;
if (!repoUrl && currentOrigin) repoUrl = currentOrigin;
if (!repoUrl) {
  if (DRY) log('Would create a GitHub repo (GITHUB_TOKEN or gh)');
  else if (GH_TOKEN) {
    const me = await api('https://api.github.com', '/user', { token: GH_TOKEN, headers: { Accept: 'application/vnd.github+json' } });
    if (me.status !== 200) die('GITHUB_TOKEN was rejected by GitHub.');
    const made = await api('https://api.github.com', '/user/repos', {
      method: 'POST', token: GH_TOKEN, headers: { Accept: 'application/vnd.github+json' },
      body: { name: NAME, private: !flag('public') },
    });
    if (made.status === 201) repoUrl = made.data.clone_url;
    else if (made.status === 422) repoUrl = `https://github.com/${me.data.login}/${NAME}.git`; // already exists
    else die(`GitHub repo creation failed (HTTP ${made.status}): ${made.data?.message}`);
    log(`GitHub repo: ${repoUrl}`);
  } else if (run('gh', ['--version'], { quiet: true }).status === 0 && run('gh', ['auth', 'status'], { quiet: true }).status === 0) {
    const g = run('gh', ['repo', 'create', NAME, flag('public') ? '--public' : '--private', '--source', '.', '--remote', 'origin']);
    if (g.status !== 0) die('gh repo create failed:\n' + g.stderr);
    repoUrl = run('git', ['remote', 'get-url', 'origin'], { quiet: true }).stdout.trim();
  } else {
    // Do NOT read Git's stored credentials to create it yourself: that is refused as credential access.
    die('No way to create the GitHub repo: no --repo, no GITHUB_TOKEN, no authenticated gh CLI.\n' +
      'Ask the user to either (a) create an EMPTY repo at github.com/new and give you its URL (rerun with --repo <url>), or\n' +
      '(b) give you a token that can create repositories (rerun with GITHUB_TOKEN=... set for this command).');
  }
}
if (!DRY) {
  if (!currentOrigin) run('git', ['remote', 'add', 'origin', repoUrl]);
  else if (currentOrigin !== repoUrl) run('git', ['remote', 'set-url', 'origin', repoUrl]);
  // No GIT_TERMINAL_PROMPT=0: if the stored login expired, Git Credential Manager must be able to
  // open its browser sign-in, which is how the SkyBook push got through.
  const p = gitNet(['push', '-u', 'origin', 'main']);
  if (p.status !== 0) die('git push failed:\n' + (p.stderr || p.stdout) + '\nIf this is an auth error, ask the user to approve the Git Credential Manager sign-in, or to supply GITHUB_TOKEN.');
  log('Pushed to ' + repoUrl);
}
const renderRepo = repoUrl.replace(/\.git$/, '');

// --- 4. Render service ----------------------------------------------------------------------------
let serviceId = existing?.id;
let deployId;
let url = existing?.serviceDetails?.url;
if (existing) log(`Render service "${NAME}" already exists (${serviceId}); pushing to main auto-deploys it.`);
else if (DRY) log(`Would create Render web service "${NAME}" from ${renderRepo} (free plan, ${REGION})`);
else {
  const created = await render('/services', {
    method: 'POST',
    body: {
      type: 'web_service', name: NAME, ownerId: owner.id, repo: renderRepo, branch: 'main', autoDeploy: 'yes',
      serviceDetails: {
        runtime: 'node', plan: 'free', region: REGION, healthCheckPath: '/api/health',
        envSpecificDetails: { buildCommand: 'npm install --include=dev && npm run build', startCommand: 'npm start' },
      },
      envVars: [
        { key: 'NODE_VERSION', value: '22' },
        { key: 'DATABASE_URL', value: dbUrl },
        { key: 'BETTER_AUTH_SECRET', generateValue: true },
      ],
    },
  });
  if (created.status === 402) die('Render requires a payment method on this workspace before it will create a web service (even on the free plan). Ask the user to add a card at https://dashboard.render.com/billing, then rerun.');
  if (created.status !== 201) die(`Render service creation failed (HTTP ${created.status}): ${created.data?.message ?? JSON.stringify(created.data)}\n` +
    'If it mentions repository access, the Render account is not connected to that GitHub repo: ask the user to install the Render GitHub app for it, or make the repo public.');
  serviceId = created.data.service.id;
  deployId = created.data.deployId;
  url = created.data.service.serviceDetails.url;
  log(`Created Render service ${serviceId} -> ${url}`);
}

// --- 5. Wait until live ---------------------------------------------------------------------------
if (!DRY) {
  const terminalBad = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);
  // An existing service starts its new deploy a few seconds after the push; without this pause the
  // loop could read the previous deploy's "live" status.
  if (existing) await new Promise((r) => setTimeout(r, 20000));
  for (let i = 0; i < 90; i++) {
    const d = deployId
      ? (await render(`/services/${serviceId}/deploys/${deployId}`)).data
      : (await render(`/services/${serviceId}/deploys?limit=1`)).data?.[0]?.deploy;
    const status = d?.status;
    if (status === 'live') { log('Deploy is live'); break; }
    if (terminalBad.has(status)) die(`Deploy ${status}. Read the build log at https://dashboard.render.com/web/${serviceId}`);
    if (i === 89) die('Timed out waiting for the deploy (15 minutes). Check the Render dashboard.');
    await new Promise((r) => setTimeout(r, 10000));
  }
  if (!url) url = (await render(`/services/${serviceId}`)).data?.serviceDetails?.url;

  // --- 6. Verify --------------------------------------------------------------------------------
  // The free plan sleeps; the first request can take 30 s, so allow for it.
  let health;
  for (let i = 0; i < 12; i++) {
    health = await fetch(`${url}/api/health`).then((r) => r.json()).catch(() => null);
    if (health?.ok) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!health?.ok) die(`${url}/api/health did not return {"ok":true}.`);
  const deep = await fetch(`${url}/bookings`).then((r) => r.status);
  const asset = await fetch(`${url}/assets/x.js`).then((r) => r.status);
  log(`health ok | deep link ${deep} (want 200) | missing asset ${asset} (want 404)`);
  if (deep !== 200 || asset !== 404) die('SPA fallback is wrong (deep link must serve the app; a missing asset must 404).');

  if (!flag('skip-smoke')) {
    log('Running smoke test against production (may take a minute: sign-ups are rate limited)...');
    const s = spawnSync('npm run smoke', { encoding: 'utf8', shell: true, env: { ...process.env, BASE_URL: url } });
    log((s.stdout || '').trim().split('\n').slice(-8).join('\n'));
    if (s.status !== 0) die('Smoke test failed against production:\n' + (s.stderr || '').slice(-600));
  }
  log(`\nDEPLOYED: ${url}\n  service ${serviceId} | repo ${renderRepo} | workspace ${owner.name} <${owner.email}>`);
  log('Next: tell the user to rotate any API key they pasted into chat; record the URL and service id in the project CLAUDE.md.');
} else log('\nDry run complete. Nothing outward was done.');
