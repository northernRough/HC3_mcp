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
import { realPng64 } from './png-fixture.mjs';
import { strict as assert } from 'node:assert';

const uploadIcons = icons.handlers.upload_icons;
const CONFIG = { host: '192.0.2.10', port: 80, username: 'u', password: 'p' };
const realFetch = globalThis.fetch;

// A real PNG: upload_icon walks chunks, checks CRCs and inflates the IDAT,
// so a header stub would be rejected before the batch logic under test runs.
const PNG = realPng64({ colorType: 3 });
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

await check('hint is code-driven for a type that holds ONE image', async () => {
  // genericDevice — a QuickApp tile, and the common case for this tool. One
  // icon is one image, so HC3 has no value to switch on and choosing between
  // the variants a batch uploaded really is code-driven.
  const r = await uploadIcons(fakeHc3(), {
    images: [img('idle')], mime: 'image/png', category: 'device',
    deviceTemplate: 'com.fibaro.genericDevice', luaTableName: 'WateringIcons',
  });
  assert.match(r.hint, /updateProperty\("deviceIcon"/);
  assert.match(r.hint, /WateringIcons/);
  assert.match(r.hint, /single image/);
  assert.match(r.hint, /code-driven/);
});

await check('hint does NOT claim code-driven switching for a state-set type', async () => {
  // The claim this replaces was flat: "Device icons are single-image sets --
  // HC3 has no multi-state upload -- so every state change is code-driven".
  // For a relay or a dimmer every clause of that is wrong, and it was the
  // sentence a caller read after a successful batch.
  const r = await uploadIcons(fakeHc3(), {
    images: [{ label: 'idle', states: { '0': PNG, '100': PNG } }],
    mime: 'image/png', category: 'device',
    deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.match(r.hint, /sets of 2/);
  assert.match(r.hint, /from the device's own value/);
  assert.match(r.hint, /needs no code/);
  assert.ok(!/no multi-state upload/.test(r.hint), 'HC3 does accept multi-state uploads');
  assert.ok(!/every state change is code-driven/.test(r.hint), 'HC3 switches states itself for a set type');
});

await check('hint names the dimmer set rather than generalising from the relay', async () => {
  const r = await uploadIcons(fakeHc3(), {
    images: [{ label: 'idle', states: Object.fromEntries(
      ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100'].map(k => [k, PNG])) }],
    mime: 'image/png', category: 'device',
    deviceTemplate: 'com.fibaro.multilevelSwitch',
  });
  assert.match(r.hint, /sets of 11/);
  assert.match(r.hint, /0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100/);
});

await check('a room batch is not told to call modify_device', async () => {
  // The old hint was unconditionally device-shaped, so a room or scene batch
  // was handed a call that does not attach a room icon. upload_icon's hint has
  // been category-aware for releases; this one never was.
  const room = await uploadIcons(fakeHc3(), { images: [img('a')], mime: 'image/png', category: 'room' });
  assert.match(room.hint, /modify_room/);
  assert.ok(!/modify_device/.test(room.hint), 'a room icon does not attach through modify_device');
  assert.ok(!/deviceIcon/.test(room.hint), 'and not through deviceIcon either');
  assert.match(room.hint, /by NAME/);

  const scene = await uploadIcons(fakeHc3(), { images: [img('a')], mime: 'image/png', category: 'scene' });
  assert.match(scene.hint, /modify_scene/);
  assert.ok(!/modify_device/.test(scene.hint));
});

await check('an unknown device type asserts neither model', async () => {
  // Saying the wrong one is worse than saying nothing: both claims steer real
  // decisions about whether the caller has to write switching code.
  const r = await uploadIcons(fakeHc3(), {
    images: [img('a')], mime: 'image/png', category: 'device',
    deviceTemplate: 'com.fibaro.somethingNew',
  });
  assert.match(r.hint, /modify_device/);
  assert.ok(!/single image/.test(r.hint));
  assert.ok(!/sets of/.test(r.hint));
});

await check('nothing a CLIENT can read claims HC3 has no multi-state upload', async () => {
  // Same guard style as the properties.icon one in unit-upload-icon.mjs, and
  // for the same reason: this claim was live in two places at once — the
  // runtime hint AND the tool description — so fixing one copy while leaving
  // the other is how the package ends up answering differently depending on
  // which one the reader reaches for.
  //
  // Checks the surfaces a client actually sees rather than the source text, so
  // a comment may quote the old wording as history without tripping this. That
  // is not a loophole: a comment is not something a client can read, and the
  // point is what reaches one.
  //
  // DEVICE_STATE_MODEL is the authority: a relay holds 2 images, a dimmer 11,
  // HC3 accepts them as a set and switches between them by device value.
  const surfaces = icons.schemas.map(s => `${s.name}: ${s.description}`);

  for (const template of [undefined, 'com.fibaro.genericDevice', 'com.fibaro.binarySwitch', 'com.fibaro.multilevelSwitch']) {
    const states = template === 'com.fibaro.binarySwitch' ? { '0': PNG, '100': PNG } : undefined;
    const r = await uploadIcons(fakeHc3(), {
      images: [states ? { label: 'a', states } : img('a')],
      mime: 'image/png',
      category: template ? 'device' : 'room',
      ...(template ? { deviceTemplate: template } : {}),
    });
    surfaces.push(`hint(${template ?? 'room'}): ${r.hint}`);
  }

  for (const text of surfaces) {
    assert.ok(
      !/no multi-state upload/.test(text),
      `HC3 does accept multi-state uploads, and this says otherwise — ${text.slice(0, 80)}`,
    );
    assert.ok(
      !/Device icons are single-image sets/.test(text),
      `whether an icon is one image or a set is a property of the device TYPE — ${text.slice(0, 80)}`,
    );
  }
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll upload_icons checks passed');
process.exit(failures ? 1 : 0);
