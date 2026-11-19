#!/usr/bin/env node
// Unit tests for the QuickApp log archive's merge and retention rules
// (scripts/log-archive-core.mjs). No gateway needed.

import assert from 'node:assert/strict';
import { parseSlot, mergeDay, normaliseDay, expiredFiles, daysBefore, eventKey, canonical, SLOT_NAME } from '../log-archive-core.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; };

// A slot as eventlog.lua stores it (shape taken from roomManager's log child,
// 18 Nov 2026): JSON text in the variable.
const slotText = JSON.stringify({
  src: 'ROOMMGR-4742', date: '2026-11-18', day: 20775, dropped: 0,
  ev: [
    [1795000000, 'start', { log: '1.0', v: '0.5' }],
    [1795000100, 'I', 'Lounge: hold'],
  ],
});

t('parseSlot reads JSON text', () => {
  const s = parseSlot(slotText);
  assert.equal(s.date, '2026-11-18');
  assert.equal(s.src, 'ROOMMGR-4742');
  assert.equal(s.ev.length, 2);
});

t('parseSlot reads an already-decoded value', () => {
  const s = parseSlot(JSON.parse(slotText));
  assert.equal(s.ev.length, 2);
});

t('parseSlot rejects empty, junk and wrong shapes', () => {
  assert.equal(parseSlot(''), null);
  assert.equal(parseSlot('not json'), null);
  assert.equal(parseSlot('[]'), null);
  assert.equal(parseSlot(JSON.stringify({ date: 'yesterday', ev: [] })), null);
  assert.equal(parseSlot(JSON.stringify({ date: '2026-11-18' })), null);
});

t('parseSlot drops malformed events but keeps the rest', () => {
  const s = parseSlot(JSON.stringify({ date: '2026-11-18', ev: [[1, 'I', 'ok'], 'bad', [], ['x', 'I']] }));
  assert.equal(s.ev.length, 1);
});

t('SLOT_NAME matches ring slots only', () => {
  assert.ok(SLOT_NAME.test('ev_00'));
  assert.ok(SLOT_NAME.test('ev_29'));
  assert.ok(!SLOT_NAME.test('state'));
  assert.ok(!SLOT_NAME.test('ev_'));
});

t('first read creates the day with every event', () => {
  const { doc, added } = mergeDay(null, parseSlot(slotText), { qaId: 4742, qaName: 'roomManager', logDeviceId: 5043, now: 100 });
  assert.equal(added, 2);
  assert.equal(doc.ev.length, 2);
  assert.equal(doc.qaId, 4742);
  assert.equal(doc.firstArchivedAt, 100);
});

t('a re-read of the same slot adds nothing', () => {
  const first = mergeDay(null, parseSlot(slotText), { now: 100 }).doc;
  const { doc, added } = mergeDay(first, parseSlot(slotText), { now: 200 });
  assert.equal(added, 0);
  assert.equal(doc.ev.length, 2);
  assert.equal(doc.lastArchivedAt, 100, 'unchanged day keeps its last-archived time');
});

t('events the gateway later drops for size survive in the archive', () => {
  const first = mergeDay(null, parseSlot(slotText), { now: 100 }).doc;
  // Later in the day: the oldest event was dropped, a new one arrived.
  const later = parseSlot(JSON.stringify({
    src: 'ROOMMGR-4742', date: '2026-11-18', dropped: 1,
    ev: [[1795000100, 'I', 'Lounge: hold'], [1795000200, 'W', 'late']],
  }));
  const { doc, added } = mergeDay(first, later, { now: 300 });
  assert.equal(added, 1);
  assert.deepEqual(doc.ev.map(e => e[0]), [1795000000, 1795000100, 1795000200]);
  assert.equal(doc.dropped, 1);
  assert.equal(doc.lastArchivedAt, 300);
});

t('events are kept in time order even if read out of order', () => {
  const a = parseSlot(JSON.stringify({ date: '2026-11-18', ev: [[30, 'I', 'c']] }));
  const b = parseSlot(JSON.stringify({ date: '2026-11-18', ev: [[10, 'I', 'a'], [20, 'I', 'b']] }));
  const d1 = mergeDay(null, a, {}).doc;
  const d2 = mergeDay(d1, b, {}).doc;
  assert.deepEqual(d2.ev.map(e => e[2]), ['a', 'b', 'c']);
});

t('two different events at the same second are both kept', () => {
  const s = parseSlot(JSON.stringify({ date: '2026-11-18', ev: [[10, 'I', 'a'], [10, 'I', 'b'], [10, 'snap', { rs: [] }]] }));
  assert.equal(mergeDay(null, s, {}).doc.ev.length, 3);
  assert.notEqual(eventKey([10, 'I', 'a']), eventKey([10, 'I', 'b']));
});

t('daysBefore does calendar arithmetic across months and years', () => {
  assert.equal(daysBefore('2026-11-19', 730), '2024-11-19');
  assert.equal(daysBefore('2026-03-01', 1), '2026-02-28');
  assert.equal(daysBefore('2026-01-01', 1), '2025-12-31');
});

t('retention removes only day files older than the window', () => {
  const files = ['2024-11-18.json', '2024-11-19.json', '2026-11-18.json', 'index.json', '2024-01-01.json.tmp'];
  assert.deepEqual(expiredFiles(files, '2026-11-19', 730), ['2024-11-18.json']);
});

// 19 Nov 2026: Lua re-encodes objects with keys in a different order after a
// QuickApp restart, so the same event can arrive as different text.
t('the same event with its keys in another order is one event', () => {
  const a = [1795000000, 'snap', { u: 58, f: 38, c: { x: 1, y: 2 } }];
  const b = [1795000000, 'snap', { c: { y: 2, x: 1 }, f: 38, u: 58 }];
  assert.equal(eventKey(a), eventKey(b));
  const first = mergeDay(null, parseSlot(JSON.stringify({ date: '2026-11-18', ev: [a] })), {}).doc;
  const r = mergeDay(first, parseSlot(JSON.stringify({ date: '2026-11-18', ev: [b] })), {});
  assert.equal(r.added, 0);
  assert.equal(r.doc.ev.length, 1);
});

t('canonical sorts keys at every level and keeps arrays in order', () => {
  assert.equal(canonical({ b: [2, { d: 1, c: 0 }], a: null }), '{"a":null,"b":[2,{"c":0,"d":1}]}');
});

t('a genuine repeat in the slot is kept, and not multiplied by later reads', () => {
  const e = [1795000000, 'W', 'Fan-only speeds'];
  const s = parseSlot(JSON.stringify({ date: '2026-11-18', ev: [e, e, [1795000001, 'I', 'x']] }));
  const one = mergeDay(null, s, {});
  assert.equal(one.doc.ev.length, 3);
  const two = mergeDay(one.doc, s, {});
  assert.equal(two.added, 0);
  assert.equal(two.doc.ev.length, 3);
});

t('normaliseDay collapses key-order duplicates and leaves the rest', () => {
  const doc = { date: '2026-11-18', ev: [
    [1, 'snap', { a: 1, b: 2 }], [1, 'snap', { b: 2, a: 1 }], [2, 'I', 'x'],
  ] };
  const r = normaliseDay(doc);
  assert.equal(r.removed, 1);
  assert.equal(r.doc.ev.length, 2);
  assert.equal(normaliseDay(r.doc).removed, 0);
});

console.log(`unit-log-archive: ${n} passed`);
