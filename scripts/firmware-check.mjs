#!/usr/bin/env node
// What did a firmware update change?
//
// Not a monitor and not a test suite. You run it once BEFORE a firmware
// update and once AFTER, and it tells you what is newly broken, what has been
// fixed, and what merely looks different. Nothing here runs on a schedule,
// because firmware on this gateway does not arrive on one.
//
//   node scripts/firmware-check.mjs                 # record, and diff vs the last record
//   node scripts/firmware-check.mjs --with-writes   # also probe write behaviour (throwaway objects)
//   node scripts/firmware-check.mjs --list          # what has been recorded so far
//
// Records are kept per firmware version in scripts/test/firmware/, so the
// pre-update run is still there after the update — which is the whole point.
//
// THREE TIERS, in descending order of how much they tell you:
//
//   1. Dead endpoints. The highest-signal tier by far. KNOWN_DEAD_ENDPOINTS.md
//      already says which endpoints return what, and explicitly warns that the
//      STARTING_SERVICES-conditional set "can come back to life or break again"
//      across upgrades. This tier walks that documentation and reports where
//      the gateway now disagrees with it. A firmware that revives /api/energy
//      is exactly the "improved" case, and nothing else would tell you.
//
//   2. Response shapes. Structural signatures for every read-only tool, using
//      the stable shape function — cardinality and runtime keys excluded, so a
//      new device does not read as an API change.
//
//   3. Write behaviour (--with-writes). The silent-write catalogue: the writes
//      HC3 accepts and does not act on. If a firmware fixes one of those, that
//      is very good news that no read-only check can see. Uses probe.mjs
//      throwaway objects with guaranteed teardown.
//
// What it CANNOT do is at the bottom of the report, named rather than omitted.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPClient } from './test/mcp-client.mjs';
import { defaultArgsFor } from './test/default-args.mjs';
import { shape, HETEROGENEOUS } from './test/shape.mjs';
import { requireCredentials, targetHost } from './test/credentials.mjs';
import { client as hc3Client } from './probe.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SERVER = resolve(ROOT, 'out/mcp/hc3-mcp-server.js');
const RECORD_DIR = resolve(__dirname, 'test/firmware');
const DEAD_DOC = resolve(ROOT, 'KNOWN_DEAD_ENDPOINTS.md');

const withWrites = process.argv.includes('--with-writes');
const listOnly = process.argv.includes('--list');
const READ_ONLY = /^(get|list|find|filter|explain|audit|read|snapshot|can)_/;

// --- records ----------------------------------------------------------

function records() {
  if (!existsSync(RECORD_DIR)) return [];
  return readdirSync(RECORD_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: join(RECORD_DIR, f), ...JSON.parse(readFileSync(join(RECORD_DIR, f), 'utf8')) }))
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
}

// --- tier 1: the documented dead endpoints ----------------------------

/**
 * Parse KNOWN_DEAD_ENDPOINTS.md rather than keeping a second list in code.
 * The document is the source of truth and is already maintained; a duplicate
 * would drift, which is the failure this repo keeps hitting.
 *
 * Headings look like:  ### `GET /api/energy` — HTTP 500
 * and for the 200-with-wrong-body cases, prose after the em dash instead.
 */
function parseDeadEndpoints() {
  const md = readFileSync(DEAD_DOC, 'utf8');
  const out = [];
  const re = /^### `(GET|POST|PUT|DELETE) ([^`]+)` — (.+)$/gm;
  let m;
  while ((m = re.exec(md)) !== null) {
    const [, method, path, verdict] = m;
    const status = /HTTP (\d{3})/.exec(verdict)?.[1];
    out.push({
      method,
      path: path.trim(),
      documented: status ? Number(status) : null,
      note: status ? null : verdict.trim(),
      // A path with a placeholder or wildcard cannot be called as written.
      callable: !/[{}*]/.test(path),
    });
  }
  return out;
}

async function probeDeadEndpoints() {
  // Uses the server's own HTTP client, so this measures what a tool would see
  // rather than what curl sees — the two differ, since the client raises on
  // non-2xx and unwraps HC3's action-result envelope.
  const hc3 = await hc3Client();
  const spec = parseDeadEndpoints();
  const results = [];
  for (const e of spec) {
    if (!e.callable) { results.push({ ...e, skipped: 'placeholder path' }); continue; }
    if (e.method !== 'GET') { results.push({ ...e, skipped: 'not a GET — would mutate' }); continue; }
    let observed = null, detail = null, bodyShape = null;
    try {
      const body = await hc3.request(e.path);
      observed = 200;
      // A 200 is not proof of life here: two documented endpoints answer 200
      // with the wrong body entirely. Record the shape so that case is visible.
      bodyShape = shape(body);
    } catch (err) {
      const msg = String(err?.message ?? err);
      observed = Number(/HTTP (\d{3})/.exec(msg)?.[1]) || null;
      detail = msg.slice(0, 140);
    }
    results.push({ ...e, observed, bodyShape, detail });
  }
  return results;
}

// --- tier 2: response shapes -----------------------------------------

async function probeShapes(client, tools) {
  const shapes = {}, errors = {}, skipped = [];
  for (const t of tools) {
    if (!READ_ONLY.test(t.name)) continue;
    const args = defaultArgsFor(t.name);
    if (args === null || args === undefined) { skipped.push(t.name); continue; }
    try {
      const res = await client.rpc('tools/call', { name: t.name, arguments: args }, 30000);
      const text = res?.result?.content?.[0]?.text;
      if (res?.result?.isError) { errors[t.name] = String(text).slice(0, 160); continue; }
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
      shapes[t.name] = shape(parsed);
    } catch (err) {
      errors[t.name] = String(err?.message ?? err).slice(0, 160);
    }
  }
  return { shapes, errors, skipped };
}

// --- diffing ----------------------------------------------------------

/**
 * Describe a shape change as fields gained and lost, not as two shapes.
 *
 * Printing both signatures is useless in practice: get_devices unions every
 * device type on the gateway, so its signature runs to several kilobytes and
 * one added field is invisible inside it. The first real run of this differ
 * produced 48 KB of output for three seeded changes. What a person needs is
 * "gained legacyFlag", so that is what this returns.
 */
function describeShapeChange(was, now) {
  const fields = s => new Set(String(s).match(/[A-Za-z_][\w]*:/g)?.map(x => x.slice(0, -1)) ?? []);
  const a = fields(was), b = fields(now);
  const gained = [...b].filter(x => !a.has(x)).sort();
  const lost = [...a].filter(x => !b.has(x)).sort();

  const cap = (arr, n = 12) =>
    arr.length > n ? `${arr.slice(0, n).join(', ')} … (+${arr.length - n} more)` : arr.join(', ');

  if (!gained.length && !lost.length) {
    // Same field names, different types or nesting. Show a bounded excerpt
    // rather than the whole thing.
    const short = s => (String(s).length > 200 ? String(s).slice(0, 200) + '…' : String(s));
    return `structure changed, same field names\n      was ${short(was)}\n      now ${short(now)}`;
  }
  const parts = [];
  if (lost.length) parts.push(`lost: ${cap(lost)}`);
  if (gained.length) parts.push(`gained: ${cap(gained)}`);
  return parts.join('\n      ');
}

function diff(prev, now) {
  const broken = [], fixed = [], changed = [], noisy = [];

  for (const e of now.deadEndpoints ?? []) {
    const was = (prev.deadEndpoints ?? []).find(p => p.path === e.path && p.method === e.method);
    if (e.skipped || !was || was.skipped) continue;
    if (was.observed !== e.observed) {
      const line = `${e.method} ${e.path}: ${was.observed} → ${e.observed}`;
      // 2xx now, error before = the endpoint came back.
      if (e.observed && e.observed < 400 && was.observed >= 400) fixed.push(`${line}  (endpoint revived)`);
      else if (was.observed < 400 && e.observed >= 400) broken.push(`${line}  (endpoint died)`);
      else changed.push(line);
    }
  }

  const allTools = new Set([...Object.keys(prev.shapes ?? {}), ...Object.keys(now.shapes ?? {})]);
  for (const t of allTools) {
    const a = prev.shapes?.[t], b = now.shapes?.[t];
    if (a === b) continue;
    if (a && !b) { broken.push(`${t}: no longer returns a shape (now: ${now.errors?.[t] ?? 'absent'})`); continue; }
    if (!a && b) {
      // A tool that was ERRORING and now returns cleanly is a fix, and the
      // errors pass below reports it as one. Only call it "newly present" if
      // it was genuinely absent, or the same event lands in two sections and
      // the report overstates how much moved.
      if (!prev.errors?.[t]) changed.push(`${t}: newly present`);
      continue;
    }
    (HETEROGENEOUS.has(t) ? noisy : changed).push(`${t}: ${describeShapeChange(a, b)}`);
  }

  for (const t of Object.keys(now.errors ?? {})) {
    if (prev.shapes?.[t] && !now.shapes?.[t]) continue; // already counted
    if (!prev.errors?.[t]) broken.push(`${t}: now errors — ${now.errors[t]}`);
  }
  for (const t of Object.keys(prev.errors ?? {})) {
    if (!now.errors?.[t] && now.shapes?.[t]) fixed.push(`${t}: was erroring, now returns cleanly`);
  }

  return { broken, fixed, changed, noisy };
}

// --- main -------------------------------------------------------------

async function main() {
  if (listOnly) {
    const rs = records();
    if (!rs.length) return console.log('No records yet. Run without --list to make the first one.');
    console.log('\nRecorded firmware characterisations:\n');
    for (const r of rs) {
      console.log(`  ${String(r.firmware).padEnd(12)} ${r.recordedAt}  ${Object.keys(r.shapes ?? {}).length} tools, ` +
        `${(r.deadEndpoints ?? []).filter(e => !e.skipped).length} endpoints${r.writeBehaviour ? ', writes probed' : ''}`);
    }
    console.log('\nA diff runs automatically against the newest record of a DIFFERENT firmware.\n');
    return;
  }

  const { source } = requireCredentials();
  console.log(`\n  credentials: ${source}`);
  console.log(`  gateway    : ${targetHost()}`);

  const client = new MCPClient({ serverPath: SERVER });
  await client.initialize();
  const tools = (await client.rpc('tools/list')).result.tools;

  const call = async (name, args = {}) => {
    const r = await client.rpc('tools/call', { name, arguments: args }, 30000);
    const text = r?.result?.content?.[0]?.text;
    try { return JSON.parse(text); } catch { return text; }
  };

  const sys = await call('get_system_info').catch(() => ({}));
  const firmware = sys?.softVersion ?? sys?.version ?? 'unknown';
  const serial = sys?.serialNumber ?? sys?.serial ?? 'unknown';
  console.log(`  firmware   : ${firmware}  (serial ${serial})\n`);

  console.log('  tier 1 — documented dead endpoints…');
  const deadEndpoints = await probeDeadEndpoints();
  const disagree = deadEndpoints.filter(e => !e.skipped && e.documented && e.observed !== e.documented);
  console.log(`    ${deadEndpoints.filter(e => !e.skipped).length} callable, ${disagree.length} disagreeing with the documentation`);

  console.log('  tier 2 — response shapes…');
  const { shapes, errors, skipped } = await probeShapes(client, tools);
  console.log(`    ${Object.keys(shapes).length} recorded, ${Object.keys(errors).length} errored`);

  let writeBehaviour = null;
  if (withWrites) {
    console.log('  tier 3 — write behaviour (throwaway objects)…');
    const { probeWriteBehaviour } = await import('./firmware-writes.mjs');
    writeBehaviour = await probeWriteBehaviour();
    const surprises = writeBehaviour.filter(w => w.matchesDocumented === false);
    const inconclusive = writeBehaviour.filter(w => w.matchesDocumented === null);
    console.log(`    ${writeBehaviour.length} probed, ${surprises.length} no longer behaving as documented`
      + (inconclusive.length ? `, ${inconclusive.length} inconclusive by design` : ''));
    for (const s of surprises) console.log(`      ! ${s.name}: ${s.observed}`);
  }

  client.close();

  const record = {
    firmware, serial,
    recordedAt: new Date().toISOString(),
    gateway: targetHost(),
    deadEndpoints, shapes, errors, skipped, writeBehaviour,
  };

  mkdirSync(RECORD_DIR, { recursive: true });
  const file = join(RECORD_DIR, `${String(firmware).replace(/[^\w.]/g, '_')}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`\n  recorded → ${file.replace(ROOT + '/', '')}`);

  // Diff against the newest record from a DIFFERENT firmware. Comparing two
  // runs of the same firmware would only show house churn.
  const prior = records().filter(r => r.firmware !== firmware).pop();
  if (!prior) {
    console.log('\n  No earlier firmware on record, so nothing to compare yet.');
    console.log('  This run IS the baseline. Re-run it after the next firmware update.\n');
    return report(record, null, null);
  }

  console.log(`\n  comparing against ${prior.firmware} (recorded ${prior.recordedAt.slice(0, 10)})\n`);
  return report(record, prior, diff(prior, record));
}

function report(record, prior, d) {
  const line = '  ' + '─'.repeat(66);
  if (d) {
    console.log(line);
    const section = (title, items, empty) => {
      console.log(`\n  ${title} — ${items.length}`);
      if (!items.length) return console.log(`    ${empty}`);
      for (const i of items) console.log(`    • ${i}`);
    };
    section('BROKEN by this firmware', d.broken, 'Nothing that worked before has stopped.');
    section('FIXED by this firmware', d.fixed, 'Nothing previously broken has started working.');
    section('CHANGED, neither better nor worse', d.changed, 'No structural changes.');
    if (d.noisy.length) {
      console.log(`\n  Ignored as inherently variable — ${d.noisy.length}`);
      console.log('    These tools return whatever the house did most recently, so a');
      console.log('    difference here is not evidence about the firmware:');
      for (const i of d.noisy) console.log(`    · ${i.split('\n')[0]}`);
    }
    console.log('\n' + line);
  }

  console.log('\n  WHAT THIS RUN DID NOT CHECK');
  console.log('    · Anything requiring a human. A real tap dispatches differently from');
  console.log('      call_ui_event, so UI behaviour after a firmware update needs');
  console.log('      scripts/probe-uicallbacks.mjs --hold and a finger on a phone.');
  console.log('    · Endpoints whose documented path carries a {placeholder} or wildcard.');
  if (!record.writeBehaviour) {
    console.log('    · Write behaviour — the silent-write catalogue. Re-run with');
    console.log('      --with-writes to include it (throwaway objects, guaranteed teardown).');
  }
  console.log('    · Z-Wave parameter transmission, which no API read can confirm.\n');
}

main().catch(err => { console.error(`\n${err.message}\n`); process.exit(1); });
