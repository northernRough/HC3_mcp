#!/usr/bin/env node
// Keep the long view of every QuickApp's event log on the Pi.
//
// Why. QuickApps that include eventlog.lua keep their own log, one variable
// per day, on a hidden "<QA name> log" child (see scripts/log-archive-core.mjs
// for the layout). Thirty days of that held on the gateway pushed HC3 memory
// to 98% and lay behind the reboots of 13-18 Nov 2026: every save rewrites the
// whole day slot, and the HC3 keeps copies of those large property values in
// memory. The owner wants the long view kept for trends, so the history moves
// here and the gateway keeps only a short buffer.
//
// How. The Pi COLLECTS; the gateway never pushes. Each run reads every log
// child's day slots and merges them into one file per QuickApp per day. The
// gateway makes no outgoing call, so a Pi that is off cannot make anything
// pile up in HC3 memory; when the Pi comes back it catches up from whatever
// the gateway still holds (its buffer must therefore be longer than any
// outage you want to survive — 3 days today).
//
// Reads are cheap for the gateway: a probe on 18 Nov 2026 pulled 1.9 MB and
// 0.9 MB bodies back to back with HC3 memory steady at 81-82% throughout.
// Runs are still paced, because nobody is waiting for them.
//
//   node scripts/log-archive-pi.mjs            # collect once
//   node scripts/log-archive-pi.mjs --dry-run  # read and report, write nothing
//
// Environment:
//   HC3_LOG_ARCHIVE_DIR    where the archive lives (default /var/lib/hc3-mcp/logs)
//   HC3_LOG_ARCHIVE_DAYS   days to keep on the Pi (default 730, two years)
//   HC3_LOG_ARCHIVE_PACE_MS  pause between log devices (default 500)
//
// Layout on disk:
//   <dir>/<qaId>/<YYYY-MM-DD>.json   one day of one QuickApp, merged
//   <dir>/index.json                 which QuickApps exist, their names, ranges
//
// The archive lives OUTSIDE the git checkout. /opt/hc3-mcp/src must stay
// clean or pi-update.sh (set -e, bare git pull) fails and kills its timer.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { requireCredentials } from './test/credentials.mjs';
import { SLOT_NAME, LOG_SUFFIX, parseSlot, mergeDay, expiredFiles, localDate } from './log-archive-core.mjs';

const DIR = process.env.HC3_LOG_ARCHIVE_DIR ?? '/var/lib/hc3-mcp/logs';
const RETAIN_DAYS = Number(process.env.HC3_LOG_ARCHIVE_DAYS ?? 730);
const PACE_MS = Number(process.env.HC3_LOG_ARCHIVE_PACE_MS ?? 500);
const dryRun = process.argv.includes('--dry-run');

const { env } = requireCredentials();
const BASE = `http://${env.FIBARO_HOST}:${env.FIBARO_PORT || 80}`;
const AUTH = 'Basic ' + Buffer.from(`${env.FIBARO_USERNAME}:${env.FIBARO_PASSWORD}`).toString('base64');

const log = (...a) => console.log(`[log-archive] ${a.join(' ')}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function hc3(path, init = {}) {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`HC3 ${init.method ?? 'GET'} ${path} -> ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Every eventlog child on the gateway: a generic device with a parent, named
 * "<something> log", carrying at least one ev_NN variable. The name test is a
 * cheap first cut; the variable test is what actually decides.
 */
async function findLogDevices() {
  const list = await hc3('/api/devices/filter', {
    method: 'POST',
    body: JSON.stringify({
      filters: [{ filter: 'type', value: ['com.fibaro.genericDevice'] }],
      attributes: { main: ['id', 'name', 'parentId'] },
    }),
  });
  if (!Array.isArray(list)) throw new Error('device filter returned no list');
  return list.filter(d => Number(d.parentId) > 0 && typeof d.name === 'string' && d.name.endsWith(LOG_SUFFIX));
}

/** The device's QuickApp variables, by the light endpoint first. */
async function variablesOf(id) {
  try {
    const r = await hc3(`/api/devices/${id}/properties/quickAppVariables`);
    if (r && Array.isArray(r.value)) return r.value;
  } catch { /* fall back */ }
  const d = await hc3(`/api/devices/${id}`);
  return Array.isArray(d?.properties?.quickAppVariables) ? d.properties.quickAppVariables : [];
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Write via a temp file and rename, so a crash never leaves half a day. */
function writeJsonAtomic(path, obj) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, path);
}

async function main() {
  const started = Date.now();
  const now = Math.floor(started / 1000);
  const today = localDate(now);
  if (!dryRun) mkdirSync(DIR, { recursive: true });

  const devices = await findLogDevices();
  const index = readJson(join(DIR, 'index.json')) ?? { qas: {} };
  let slotsRead = 0, daysTouched = 0, eventsAdded = 0, logDevices = 0, removed = 0;

  for (const dev of devices) {
    let vars;
    try { vars = await variablesOf(dev.id); } catch (e) {
      log(`skip ${dev.id} (${dev.name}): ${e.message}`);
      continue;
    }
    const slots = vars.filter(v => SLOT_NAME.test(String(v?.name))).map(v => parseSlot(v.value)).filter(Boolean);
    if (slots.length === 0) { await sleep(PACE_MS); continue; }   // a "... log" device that is not an eventlog
    logDevices++;
    slotsRead += slots.length;

    const qaId = Number(dev.parentId);
    const qaName = dev.name.slice(0, -LOG_SUFFIX.length);
    const qaDir = join(DIR, String(qaId));
    if (!dryRun) mkdirSync(qaDir, { recursive: true });

    for (const slot of slots) {
      const file = join(qaDir, `${slot.date}.json`);
      const existing = readJson(file);
      const { doc, added } = mergeDay(existing, slot, { qaId, qaName, logDeviceId: dev.id, now });
      if (added > 0 || !existing) {
        daysTouched++;
        eventsAdded += added;
        if (!dryRun) writeJsonAtomic(file, doc);
      }
    }

    // Retention: two years by default.
    if (!dryRun) {
      const files = readdirSync(qaDir);
      for (const f of expiredFiles(files, today, RETAIN_DAYS)) {
        try { unlinkSync(join(qaDir, f)); removed++; } catch { /* next run */ }
      }
      const days = readdirSync(qaDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      index.qas[qaId] = {
        qaId, qaName, logDeviceId: dev.id, src: slots[0].src,
        firstDate: days[0]?.slice(0, 10), lastDate: days[days.length - 1]?.slice(0, 10),
        days: days.length, lastRun: now,
      };
    }
    await sleep(PACE_MS);
  }

  if (!dryRun) {
    index.updatedAt = now;
    index.retainDays = RETAIN_DAYS;
    writeJsonAtomic(join(DIR, 'index.json'), index);
  }
  log(`${dryRun ? 'dry run: ' : ''}${logDevices} log device(s), ${slotsRead} day slot(s) read, ` +
      `${daysTouched} day file(s) updated, ${eventsAdded} new event(s), ${removed} expired file(s) removed, ` +
      `${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch(e => {
  // A gateway that is briefly unreachable is not worth failing loudly over:
  // the next run catches up from the gateway's buffer. Exit non-zero so the
  // journal shows it, without retry storms (the timer simply fires again).
  log(`run failed: ${e.message}`);
  process.exit(1);
});

