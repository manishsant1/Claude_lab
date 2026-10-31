#!/usr/bin/env node
// Copies templates/app into a new project folder and fills in the app's name and vocabulary.
//
//   node scaffold.mjs <target-dir> --name "CourtBook" --resource "Court" [--resources "Courts"]
//                     [--emoji 🎾] [--slug courtbook] [--force]
//
// The result is a complete, runnable booking app (tennis-court data). The caller then adapts
// seed data, rules and copy to the real domain (see SKILL.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'app');
const RENAMES = { _gitignore: '.gitignore', '_env.example': '.env.example' };

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--force') flags.force = true;
  else if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i];
  else positional.push(args[i]);
}

const fail = (msg) => { console.error('scaffold: ' + msg); process.exit(1); };
const [target] = positional;
if (!target || !flags.name || !flags.resource) {
  fail('usage: scaffold.mjs <target-dir> --name "App Name" --resource "Court" [--resources "Courts"] [--emoji 🎾] [--slug app-name] [--force]');
}

const pluralize = (w) =>
  /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|ch|sh)$/i.test(w) ? w + 'es' : w + 's';

const slug = (flags.slug ?? flags.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
const values = {
  __APP_NAME__: flags.name,
  __APP_SLUG__: slug,
  // Prefix for Better Auth's tables so they can live in a database shared with other apps.
  __DB_PREFIX__: slug.replaceAll('-', '_') + '_',
  __RESOURCE__: flags.resource,
  __RESOURCES__: flags.resources ?? pluralize(flags.resource),
  __EMOJI__: flags.emoji ?? '📅',
};
// Values are inserted into JS string literals and JSON, so refuse characters that would break them.
for (const [k, v] of Object.entries(values)) {
  if (/['"\`\n\r$<>{}]/.test(v)) fail(`${k} contains a character that is not allowed: ${v}`);
}

const dest = path.resolve(target);
if (fs.existsSync(dest) && fs.readdirSync(dest).length && !flags.force) {
  fail(`${dest} is not empty (use --force to copy into it; existing files are overwritten)`);
}

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const src = path.join(from, entry.name);
    const out = path.join(to, RENAMES[entry.name] ?? entry.name);
    if (entry.isDirectory()) { copy(src, out); continue; }
    let text = fs.readFileSync(src, 'utf8');
    for (const [token, value] of Object.entries(values)) text = text.replaceAll(token, value);
    fs.writeFileSync(out, text);
  }
}

copy(TEMPLATE, dest);
console.log(`Scaffolded ${values.__APP_NAME__} (${values.__APP_SLUG__}) in ${dest}`);
console.log('Next: cd into it, create .env from .env.example, npm install, npm run dev');
