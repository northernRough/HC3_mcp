#!/usr/bin/env node
// Unit test — get_debug_messages `until`. No live HC3: a fake client serves
// two newest-first pages of 3 messages linked by the nextLast cursor.
//
//   node scripts/test/unit-debug-window.mjs

import { debug } from '../../out/mcp/tools/debug.js';
import { strict as assert } from 'node:assert';

const get = debug.handlers.get_debug_messages;
const PAGES = {
  '/api/debugMessages': { nextLast: 3, messages: [
    { id: 6, timestamp: 600, tag: 'A', type: 'debug' },
    { id: 5, timestamp: 500, tag: 'B', type: 'debug' },
    { id: 4, timestamp: 400, tag: 'A', type: 'error' },
  ] },
  '/api/debugMessages?last=3': { nextLast: 0, messages: [
    { id: 3, timestamp: 300, tag: 'A', type: 'debug' },
    { id: 2, timestamp: 200, tag: 'B', type: 'debug' },
    { id: 1, timestamp: 100, tag: 'A', type: 'debug' },
  ] },
};
const fake = { async request(url) { assert.ok(PAGES[url], `unexpected ${url}`); return PAGES[url]; } };
const ids = r => r.messages.map(m => m.id);

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

await check('until alone drops newer messages and keeps paging', async () => {
  assert.deepEqual(ids(await get(fake, { until: 400 })), [4, 3, 2, 1]);
});
await check('since + until gives an inclusive window', async () => {
  assert.deepEqual(ids(await get(fake, { since: 200, until: 500 })), [5, 4, 3, 2]);
});
await check('newer messages outside the window do not use up limit', async () => {
  assert.deepEqual(ids(await get(fake, { until: 300, limit: 2 })), [3, 2]);
});
await check('combines with tagContains', async () => {
  assert.deepEqual(ids(await get(fake, { until: 450, tagContains: 'a' })), [4, 3, 1]);
});
await check('until earlier than since is refused', async () => {
  await assert.rejects(get(fake, { since: 500, until: 200 }), /earlier than since/);
});
await check('without until, behaviour unchanged', async () => {
  assert.deepEqual(ids(await get(fake, {})), [6, 5, 4, 3, 2, 1]);
});

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nunit-debug-window: all passed');
