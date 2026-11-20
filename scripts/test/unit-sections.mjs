#!/usr/bin/env node
// Unit test — get_sections. No live HC3: a fake client serves canned
// /api/sections and /api/rooms.
//
//   node scripts/test/unit-sections.mjs

import { rooms } from '../../out/mcp/tools/rooms.js';
import { strict as assert } from 'node:assert';

const get = rooms.handlers.get_sections;
const DATA = {
  '/api/sections': [
    { id: 20, name: 'Upstairs', sortOrder: 2 },
    { id: 10, name: 'Downstairs', sortOrder: 1 },
    { id: 30, name: 'Empty', sortOrder: 3 },
  ],
  '/api/rooms': [
    { id: 1, name: 'Kitchen', sectionID: 10, sortOrder: 2 },
    { id: 2, name: 'Hall', sectionID: 10, sortOrder: 1 },
    { id: 3, name: 'Bedroom', sectionID: 20 },
    { id: 4, name: 'Orphan', sectionID: 99 },
  ],
};
const fake = { async request(url) { assert.ok(url in DATA, `unexpected ${url}`); return DATA[url]; } };

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

await check('sections in sortOrder, rooms grouped and ordered', async () => {
  const r = await get(fake, {});
  assert.deepEqual(r.sections.map(s => s.name), ['Downstairs', 'Upstairs', 'Empty']);
  assert.deepEqual(r.sections[0].rooms, [{ id: 2, name: 'Hall' }, { id: 1, name: 'Kitchen' }]);
  assert.deepEqual(r.sections[2].rooms, []);
});
await check('rooms pointing at a missing section are unsectioned', async () => {
  const r = await get(fake, {});
  assert.deepEqual(r.unsectioned, [{ id: 4, name: 'Orphan', sectionID: 99 }]);
});
await check('sectionId returns one section', async () => {
  const r = await get(fake, { sectionId: 20 });
  assert.equal(r.name, 'Upstairs');
  assert.deepEqual(r.rooms, [{ id: 3, name: 'Bedroom' }]);
});
await check('unknown sectionId is refused and lists the real ones', async () => {
  await assert.rejects(get(fake, { sectionId: 5 }), /no section 5\. Sections: 10 Downstairs/);
});
await check('no arguments at all works', async () => {
  const r = await get(fake);
  assert.equal(r.sections.length, 3);
});

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nunit-sections: all passed');
