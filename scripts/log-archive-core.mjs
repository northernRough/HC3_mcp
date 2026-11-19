// Pure helpers for the QuickApp log archive (scripts/log-archive-pi.mjs).
//
// Kept apart from the runner so the merge and retention rules can be tested
// without a gateway (scripts/test/unit-log-archive.mjs).
//
// What is being archived. QuickApps that include eventlog.lua keep a ring of
// day slots on a hidden child device named "<QA name> log": one variable per
// day, ev_00 .. ev_NN, each holding
//   { "src": "VENT-5022", "date": "2026-10-31", "day": 20392,
//     "dropped": 0, "ev": [ [epoch, kind, data], ... ] }
// Today's slot is rewritten every few minutes; earlier slots are left alone
// until the ring comes round and overwrites them. If a day passes the
// QuickApp's byte cap, its oldest events are dropped from the slot.
//
// So the archive has to MERGE, not copy. A slot read later in the day can be
// missing events an earlier read already saw (dropped for size), and a slot
// can be overwritten by a newer day while the Pi was off. Keeping the union of
// everything ever read for a date loses nothing the gateway ever held.

/** Slot variable names written by eventlog.lua. */
export const SLOT_NAME = /^ev_\d+$/;

/** Name the log child carries: "<QA name> log". */
export const LOG_SUFFIX = ' log';

/**
 * Parse one slot variable value. HC3 hands a variable back either as the JSON
 * text the QuickApp stored or, for some writes, already decoded. Returns null
 * for anything that is not a day slot (empty, unparsable, wrong shape).
 */
export function parseSlot(value) {
  let doc = value;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    try { doc = JSON.parse(value); } catch { return null; }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  if (typeof doc.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) return null;
  if (!Array.isArray(doc.ev)) return null;
  const ev = doc.ev.filter(e => Array.isArray(e) && e.length >= 2 && Number.isFinite(Number(e[0])));
  return {
    src: typeof doc.src === 'string' ? doc.src : undefined,
    date: doc.date,
    day: Number.isFinite(Number(doc.day)) ? Number(doc.day) : undefined,
    dropped: Number.isFinite(Number(doc.dropped)) ? Number(doc.dropped) : 0,
    ev,
  };
}

/** Identity of one event, for de-duplication across reads. */
export function eventKey(e) {
  return JSON.stringify([Number(e[0]), e[1], e[2] === undefined ? null : e[2]]);
}

/**
 * Union of an archived day and a freshly read slot for the same date.
 * Events are kept in time order; ties keep the order they were first seen.
 * Returns { doc, added } where added is the number of events new to the archive.
 */
export function mergeDay(existing, slot, meta = {}) {
  const base = existing && Array.isArray(existing.ev) ? existing.ev : [];
  const seen = new Set(base.map(eventKey));
  const out = base.slice();
  let added = 0;
  for (const e of slot.ev) {
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    added++;
  }
  // Stable sort by epoch. Array.prototype.sort is stable in V8.
  out.sort((a, b) => Number(a[0]) - Number(b[0]));
  const doc = {
    qaId: meta.qaId ?? existing?.qaId,
    qaName: meta.qaName ?? existing?.qaName,
    logDeviceId: meta.logDeviceId ?? existing?.logDeviceId,
    src: slot.src ?? existing?.src,
    date: slot.date,
    day: slot.day ?? existing?.day,
    // The most the gateway ever reported dropping for this day. Events dropped
    // before the first read are gone; this says how many.
    dropped: Math.max(Number(existing?.dropped) || 0, Number(slot.dropped) || 0),
    firstArchivedAt: existing?.firstArchivedAt ?? meta.now,
    lastArchivedAt: added > 0 || !existing ? meta.now : existing.lastArchivedAt,
    ev: out,
  };
  return { doc, added };
}

/** Date string N days before `today` (both YYYY-MM-DD, calendar arithmetic in UTC). */
export function daysBefore(today, n) {
  const [y, m, d] = today.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Archive files (YYYY-MM-DD.json) older than the retention window. */
export function expiredFiles(fileNames, today, retainDays) {
  const cutoff = daysBefore(today, retainDays);
  return fileNames.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < cutoff);
}

/** Local calendar date of an epoch-seconds time, as YYYY-MM-DD. */
export function localDate(epochSeconds = Date.now() / 1000) {
  const d = new Date(epochSeconds * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
