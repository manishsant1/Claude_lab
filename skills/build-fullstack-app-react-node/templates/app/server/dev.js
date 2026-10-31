// Development runner: starts server/index.js and restarts it when a .js file under
// server/ or shared/ changes. Frontend changes don't need this; Vite hot-reloads them.
// (Used instead of `node --watch`, which on Windows also reacts to Vite's cache writes
// in node_modules/.vite and gets stuck in a restart loop.)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_DIRS = ['server', 'shared'];

let child = null;
let restarting = false;

function start() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => {
    child = null;
    if (restarting) {
      restarting = false;
      start();
    } else if (code) {
      console.log(`Server exited with code ${code}. Waiting for a file change to restart...`);
    }
  });
}

function restart(file) {
  console.log(`\nChange detected in ${file}, restarting...`);
  if (!child) return start();
  restarting = true;
  child.kill();
}

let timer = null;
for (const dir of WATCH_DIRS) {
  fs.watch(path.join(ROOT, dir), { recursive: true }, (event, file) => {
    if (!file?.endsWith('.js')) return;
    // Editors often write a file in several steps; wait for them to settle.
    clearTimeout(timer);
    timer = setTimeout(() => restart(path.join(dir, file)), 200);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child?.kill();
    process.exit(0);
  });
}

start();
