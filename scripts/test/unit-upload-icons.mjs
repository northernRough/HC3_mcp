#!/usr/bin/env node
// Unit test — upload_icons (batch). No live HC3: fetch is stubbed.
//
// Batching matters because each upload is a COMMITTED write: HC3 has no
// transaction, so a batch that fails partway leaves the successes on the
// gateway. The result must therefore separate uploaded from failed clearly
// enough that a caller retries only the failures instead of re-running the
// batch and creating duplicates.
//
//   node scripts/test/unit-upload-icons.mjs

import { icons } from '../../out/mcp/tools/icons.js';
import { strict as assert } from 'node:assert';

const uploadIcons = icons.handlers.upload_icons;
const CONFIG = { host: '192.0.2.10', port: 80, username: 'u', password: 'p' };
const realFetch = globalThis.fetch;

function makePng() {
  const b = Buffer.alloc(40);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0);
  b.write('IHDR', 12);
  b.writeUInt32BE(128, 16); b.writeUInt32BE(128, 20);
  b.writeUInt8(8, 24); b.writeUInt8(3, 25);
  return b.toString('base64');
}
const PNG = makePng();
const img = (label) => ({ label, base64: PNG });

// Each upload_icon call does: list (before), POST, list (after). Ids are
// handed out in ascending order, mimicking HC3's User<N> assignment.
// failOnIndex is 0-based over POSTs; the id still advances past a failure,
// so a later image is not retried against the one that failed.
function fakeHc3({ failOnIndex = [] } = {}) {
  let nextId = 1030;
  let postIndex = 0;
  let current = [];
  globalThis.fetch = async () => {
    const i = postIndex++;
    const id = nextId++;
    if (failOnIndex.includes(i)) {
      return { ok: false, status: 500, async text() { return '{"reason":"boom"}'; } };
    }
    current = [...current, { id, iconSetName: `User${id}`, fileExtension: 'png' }];
    return { ok: true, status: 200, async text() { return '{}'; } };
  };
  return {
    config: CONFIG,
    async request() { return { device: current, room: current, scene: current }; },
  };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  finally { globalThis.fetch = realFetch; }
}

await check('uploads a batch and maps labels to assigned ids', async () => {
  const r = await uploadIcons(fakeHc3(), {
    images: [img('idle'), img('watering'), img('hoseBan')],
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.genericDevice',
  });
  assert.equal(r.requested, 3);
  assert.equal(r.uploadedCount, 3);
  assert.equal(r.failedCount, 0);
  assert.deepEqual(r.labels, { idle: 1030, watering: 1031, hoseBan: 1032 });
  assert.equal(r.uploaded[0].name, 'User1030');
});

await check('emits a pasteable Lua table', async () => {
  const r = await uploadIcons(fakeHc3(), {
    images: [img('idle'), img('watering')],
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.genericDevice',
  });
  assert.equal(r.luaTable, 'local Icons = {\n    idle = 1030,\n    watering = 1031,\n}');
});

await check('labels that are not Lua identifiers use the bracket form', async () => {
  const r = await uploadIcons(fakeHc3(), {
    images: [img('mode COLD'), img('2ndStage'), img('ok_one')],
    mime: 'image/png', category: 'room',
  });
  assert.match(r.luaTable, /\["mode COLD"\] = 1030,/);
  assert.match(r.luaTable, /\["2ndStage"\] = 1031,/);   // leading digit is invalid bare
  assert.match(r.luaTable, /ok_one = 1032,/);           // valid identifier stays bare
});

await check('luaTableName is honoured, luaTable:false suppresses it', async () => {
  const named = await uploadIcons(fakeHc3(), {
    images: [img('a')], mime: 'image/png', category: 'room', luaTableName: 'WateringIcons',
  });
  assert.match(named.luaTable, /^local WateringIcons = \{/);
  const off = await uploadIcons(fakeHc3(), {
    images: [img('a')], mime: 'image/png', category: 'room', luaTable: false,
  });
  assert.ok(!('luaTable' in off));
});

await check('a partial failure keeps the successes and names the failures', async () => {
  // Second upload fails; first and third must still be reported as created.
  const r = await uploadIcons(fakeHc3({ failOnIndex: [1] }), {
    images: [img('idle'), img('watering'), img('hoseBan')],
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.genericDevice',
  });
  assert.equal(r.uploadedCount, 2);
  assert.equal(r.failedCount, 1);
  assert.equal(r.failed[0].label, 'watering');
  assert.match(r.failed[0].error, /HTTP 500/);
  assert.deepEqual(Object.keys(r.labels), ['idle', 'hoseBan']);
  // The hint must warn against re-running the batch, since that would
  // duplicate the two that already exist on the gateway.
  assert.match(r.hint, /Retry only those/);
  assert.match(r.hint, /duplicate/);
});

await check('per-image mime overrides the batch default', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  const r = await uploadIcons(fakeHc3(), {
    images: [img('png_one'), { label: 'svg_one', base64: svg, mime: 'image/svg+xml' }],
    mime: 'image/png', category: 'room',
  });
  assert.equal(r.uploaded[0].extension, 'png');
  assert.equal(r.uploaded[1].extension, 'svg');
});

await check('batch-level validation runs before ANY upload', async () => {
  let posted = false;
  globalThis.fetch = async () => { posted = true; throw new Error('should not be reached'); };
  const hc3 = { config: CONFIG, async request() { return { device: [], room: [], scene: [] }; } };

  await assert.rejects(() => uploadIcons(hc3, { images: [], category: 'room' }), /non-empty images array/);
  await assert.rejects(
    () => uploadIcons(hc3, { images: [img('a'), img('a')], mime: 'image/png', category: 'room' }),
    /duplicate label 'a'/,
  );
  await assert.rejects(
    () => uploadIcons(hc3, { images: [{ label: 'a' }], mime: 'image/png', category: 'room' }),
    /has no base64/,
  );
  await assert.rejects(
    () => uploadIcons(hc3, { images: [img('a')], category: 'room' }),
    /no mime and no top-level mime/,
  );
  await assert.rejects(
    () => uploadIcons(hc3, { images: [img('a')], mime: 'image/png', category: 'device' }),
    /requires deviceTemplate/,
  );
  await assert.rejects(
    () => uploadIcons(hc3, { images: [img('a')], mime: 'image/png', category: 'room', deviceTemplate: 'x' }),
    /only applies to category "device"/,
  );
  assert.equal(posted, false, 'no upload may be attempted when batch validation fails');
});

await check('the device deviceTemplate check fires before the first write', async () => {
  // Specifically: a 17-image batch missing deviceTemplate must create zero
  // icons, not sixteen and then stop.
  let posted = 0;
  globalThis.fetch = async () => { posted++; return { ok: true, status: 200, async text() { return '{}'; } }; };
  const hc3 = { config: CONFIG, async request() { return { device: [], room: [], scene: [] }; } };
  await assert.rejects(
    () => uploadIcons(hc3, {
      images: Array.from({ length: 17 }, (_, i) => img(`v${i}`)),
      mime: 'image/png', category: 'device',
    }),
    /requires deviceTemplate/,
  );
  assert.equal(posted, 0, `expected 0 uploads, got ${posted}`);
});

await check('hint explains that switching is code-driven', async () => {
  const r = await uploadIcons(fakeHc3(), {
    images: [img('idle')], mime: 'image/png', category: 'device',
    deviceTemplate: 'com.fibaro.genericDevice', luaTableName: 'WateringIcons',
  });
  assert.match(r.hint, /updateProperty\("deviceIcon"/);
  assert.match(r.hint, /WateringIcons/);
  assert.match(r.hint, /single-image sets/);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll upload_icons checks passed');
process.exit(failures ? 1 : 0);
