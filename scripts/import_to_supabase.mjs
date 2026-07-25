/**
 * Load the normalized CSVs into Supabase through PostgREST.
 *
 * Uses the service role key, so it bypasses RLS — this is a bulk data load, not
 * an application code path. Reads credentials from .env; nothing is hardcoded.
 *
 * Usage: node scripts/import_to_supabase.mjs [--truncate]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const file = resolve(root, '.env');
  if (!existsSync(file)) throw new Error('.env not found — cannot reach Supabase');
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');

/** Minimal CSV parse — these files are ours, but quoted commas still occur in product names. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const NUMERIC = new Set(['sales', 'quantity', 'discount', 'profit']);

function coerce(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = NUMERIC.has(k) ? (v === '' ? null : Number(v)) : (v === '' ? null : v);
  }
  return out;
}

async function insertBatch(table, rows) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      // Re-runnable: an existing primary key is skipped rather than erroring.
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

async function count(table) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
  });
  return res.headers.get('content-range')?.split('/')[1] ?? '?';
}

// Parents before children — the foreign keys demand this order.
const TABLES = ['customers', 'products', 'orders', 'order_items'];
const BATCH = 500;

if (process.argv.includes('--truncate')) {
  for (const t of [...TABLES].reverse()) {
    const res = await fetch(`${URL_BASE}/rest/v1/${t}?${t === 'order_items' ? 'id' : t.slice(0, -1) + '_id'}=neq.__none__`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=minimal' },
    });
    console.log(`  cleared ${t}: HTTP ${res.status}`);
  }
}

for (const table of TABLES) {
  const rows = parseCSV(readFileSync(resolve(root, 'data/out', `${table}.csv`), 'utf8')).map(coerce);
  process.stdout.write(`${table.padEnd(12)} ${String(rows.length).padStart(5)} rows `);
  for (let i = 0; i < rows.length; i += BATCH) {
    await insertBatch(table, rows.slice(i, i + BATCH));
    process.stdout.write('.');
  }
  console.log(` -> ${await count(table)} in database`);
}

console.log('\ndone');
