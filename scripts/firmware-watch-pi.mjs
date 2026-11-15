#!/usr/bin/env node
// Notice that the gateway's firmware changed, and verify it — unattended.
//
// The counterpart to the weekly recorder. The two triggers are deliberately
// different, and the asymmetry is the whole point:
//
//   PRE-upgrade record  — periodic only. A change-triggered run is too late:
//                         by the time it fires you are already on the new
//                         firmware and the baseline is gone forever.
//   POST-upgrade check  — change-triggered. Here the change IS the signal, and
//                         waiting for the next weekly tick is pure delay.
//
// So this runs often, does almost nothing almost every time, and springs into
// action exactly once per firmware change.
//
//   node scripts/firmware-watch-pi.mjs            # check, act if changed
//   node scripts/firmware-watch-pi.mjs --dry-run  # say what it would do
//   node scripts/firmware-watch-pi.mjs --force    # act as though it changed
//
// Environment:
//   HC3_FIRMWARE_RECORD_DIR   where records and the marker live
//   HC3_FIRMWARE_REPORT_DIR   where the human-readable issues file is written
//   HC3_FIRMWARE_WITH_WRITES  set to 1 to include the write-behaviour tier
//   HC3_FIRMWARE_NOTIFY_QA    device id of firmwareWatch (default 4985)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { requireCredentials } from './test/credentials.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHECKER = resolve(__dirname, 'firmware-check.mjs');

const RECORD_DIR = resolve(process.env.HC3_FIRMWARE_RECORD_DIR ?? join(__dirname, 'test/firmware'));
const REPORT_DIR = resolve(process.env.HC3_FIRMWARE_REPORT_DIR ?? RECORD_DIR);
// records() in firmware-check only reads *.json, so a dotfile marker can live
// alongside the records without ever being mistaken for one.
const MARKER = join(RECORD_DIR, '.last-seen-firmware');
const NOTIFY_QA = Number(process.env.HC3_FIRMWARE_NOTIFY_QA ?? 4985);

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

const { env } = requireCredentials();
const BASE = `http://${env.FIBARO_HOST}:${env.FIBARO_PORT || 80}`;
const AUTH = 'Basic ' + Buffer.from(`${env.FIBARO_USERNAME}:${env.FIBARO_PASSWORD}`).toString('base64');

const log = (...a) => console.log(`[firmware-watch] ${a.join(' ')}`);

async function hc3(path, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HC3 ${init.method ?? 'GET'} ${path} -> ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

/** What the gateway says it is running right now. */
async function currentFirmware() {
  const info = await hc3('/api/settings/info');
  if (!info?.softVersion) throw new Error('/api/settings/info returned no softVersion');
  return String(info.softVersion);
}

/**
 * Run the differ and get its verdict.
 *
 * Read-only unless explicitly asked otherwise. The write tier creates and tears
 * down throwaway objects on a live gateway — correct when a human is watching,
 * wrong on a timer that fires by itself.
 */
function runChecker() {
  const args = [CHECKER, '--json'];
  if (process.env.HC3_FIRMWARE_WITH_WRITES === '1') args.push('--with-writes');

  const out = execFileSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
    // Progress narration goes to stderr in --json mode; let it through to the
    // journal so a hung or failing run is diagnosable.
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, HC3_FIRMWARE_RECORD_DIR: RECORD_DIR },
  });
  return JSON.parse(out);
}

function writeReport(v) {
  const L = [];
  const add = s => L.push(s ?? '');
  const section = (title, items, empty) => {
    add(`## ${title} (${items.length})`); add('');
    if (!items.length) { add(`_${empty}_`); add(''); return; }
    for (const i of items) add(`- ${i}`);
    add('');
  };

  add(`# Firmware ${v.firmware} — post-upgrade verification`);
  add('');
  add(`- **Now running:** ${v.firmware}`);
  add(`- **Compared against:** ${v.baseline ? `${v.baseline.firmware} (recorded ${v.baseline.recordedAt})` : 'nothing, no earlier record'}`);
  add(`- **Gateway:** ${v.gateway} (serial ${v.serial})`);
  add(`- **Checked at:** ${v.recordedAt}`);
  add(`- **Write tier included:** ${v.withWrites ? 'yes' : 'no'}`);
  add('');

  if (v.confounded) {
    add('> **Treat these differences with suspicion.** The two records were not');
    add('> produced by the same probe, so some of what follows may be this repo');
    add('> changing rather than the firmware. Re-run the baseline commit against');
    add('> the new firmware to separate them.');
    add('>');
    add(`> - baseline probe: \`${JSON.stringify(v.baseline?.probe ?? null)}\``);
    add(`> - this probe:     \`${JSON.stringify(v.probe)}\``);
    add('');
  }

  section('Broken by this firmware', v.broken, 'Nothing that worked before has stopped.');
  section('Fixed by this firmware', v.fixed, 'Nothing previously broken has started working.');
  section('Changed, neither better nor worse', v.changed, 'No structural changes.');

  if (v.noisy?.length) {
    add('## Ignored as inherently variable');
    add('');
    add('These reflect whatever the house did most recently, so a difference is');
    add('not evidence about the firmware.');
    add('');
    for (const i of v.noisy) add(`- ${String(i).split('\n')[0]}`);
    add('');
  }

  add('## What this did NOT check');
  add('');
  for (const i of v.notChecked) add(`- ${i}`);
  add('');

  mkdirSync(REPORT_DIR, { recursive: true });
  const file = join(REPORT_DIR, `firmware-${v.firmware}-issues.md`);
  writeFileSync(file, L.join('\n'));
  return file;
}

/**
 * Tell the owner, through the QuickApp.
 *
 * Deliberately routed via firmwareWatch rather than POST /api/mobile/push:
 * fibaro.alert targets a USER and lets the hub fan out to that person's own
 * devices, whereas the push endpoint takes iOS DEVICE ids and there are stale
 * duplicates among them. Reusing the QuickApp also keeps one notification path
 * to maintain instead of two.
 */
async function notify(v, reportPath) {
  const payload = {
    version: v.firmware,
    previous: v.baseline?.firmware ?? '',
    broken: v.broken.slice(0, 8),
    brokenCount: v.broken.length,
    fixedCount: v.fixed.length,
    changedCount: v.changed.length,
    confounded: v.confounded === true,
    report: reportPath,
  };
  await hc3(`/api/devices/${NOTIFY_QA}/action/postUpgradeResult`, {
    method: 'POST',
    body: JSON.stringify({ args: [payload] }),
  });
}

async function main() {
  mkdirSync(RECORD_DIR, { recursive: true });

  const now = await currentFirmware();
  const seen = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : '';

  if (!seen) {
    // First ever run. We have no evidence an upgrade happened, and firing a
    // verification here would compare against whatever happens to be on disk
    // and announce a "result" about nothing. Just start watching.
    log(`first run, now watching ${now}`);
    if (!dryRun) writeFileSync(MARKER, now + '\n');
    return;
  }

  if (seen === now && !force) {
    log(`no change (${now})`);
    return;
  }

  log(force ? `forced run on ${now}` : `firmware changed: ${seen} -> ${now}`);
  if (dryRun) { log('dry run, stopping before the checker'); return; }

  const verdict = runChecker();
  const file = writeReport(verdict);
  log(`report written to ${file}`);
  log(`broken=${verdict.broken.length} fixed=${verdict.fixed.length} changed=${verdict.changed.length}`);

  try {
    await notify(verdict, file);
    log(`notified via QuickApp ${NOTIFY_QA}`);
  } catch (e) {
    // Never let a failed notification lose the marker update, or every
    // subsequent run re-verifies and re-alerts the same upgrade forever.
    console.error(`[firmware-watch] NOTIFICATION FAILED: ${e.message}`);
  }

  writeFileSync(MARKER, now + '\n');
}

main().catch(err => { console.error(`[firmware-watch] ${err.message}`); process.exit(1); });
