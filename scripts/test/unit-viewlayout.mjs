#!/usr/bin/env node
// Unit test — viewLayout select validation and the modify_device refusal.
//
// The trigger here is verified rather than heuristic (4.16.0, on 5.210.12), so
// unlike the Lua checker this one blocks. That raises the cost of a false
// positive to "a legitimate write is refused", so the valid-layout cases below
// matter as much as the invalid ones.
//
//   node scripts/test/unit-viewlayout.mjs

import { validateViewLayout } from '../../out/mcp/viewlayout.js';
import { devices } from '../../out/mcp/tools/devices.js';
import { strict as assert } from 'node:assert';

const modifyDevice = devices.handlers.modify_device;

const layout = (...components) => ({
  '$jason': { body: { sections: { items: [{ components }] } } },
});

const goodSelect = {
  type: 'select',
  name: 'modeSelector',
  selectionType: 'single',
  values: [{ text: 'Auto', type: 'option', value: 'auto' }],
};
const label = { type: 'label', name: 'status', text: 'idle' };

function fakeHc3() {
  const calls = [];
  const device = { id: 4933, name: 'Watering', properties: {} };
  return {
    calls,
    async request(endpoint, method = 'GET', body) {
      calls.push({ endpoint, method, body });
      if (method === 'PUT') {
        // Store what was sent, so the tool's post-write verify sees it back.
        Object.assign(device, body ?? {});
        Object.assign(device.properties, body?.properties ?? {});
        return {};
      }
      return JSON.parse(JSON.stringify(device));
    },
  };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// --- must not fire on valid layouts ---------------------------------------

await check('a well-formed select passes', () => {
  assert.deepEqual(validateViewLayout(layout(goodSelect, label)), []);
});

await check('selectionType multi passes', () => {
  assert.deepEqual(validateViewLayout(layout({ ...goodSelect, selectionType: 'multi' })), []);
});

await check('an empty values ARRAY passes', () => {
  assert.deepEqual(validateViewLayout(layout({ ...goodSelect, values: [] })), []);
});

await check('a select with no values key at all passes', () => {
  const { values, ...noValues } = goodSelect;
  assert.deepEqual(validateViewLayout(layout(noValues)), []);
});

await check('selectedItems as an array passes', () => {
  assert.deepEqual(validateViewLayout(layout({ ...goodSelect, selectedItems: [] })), []);
});

await check('layouts with no selects at all pass', () => {
  assert.deepEqual(validateViewLayout(layout(label, { type: 'button', name: 'go' })), []);
});

await check('empty and non-object inputs are handled', () => {
  assert.deepEqual(validateViewLayout({}), []);
  assert.deepEqual(validateViewLayout(null), []);
  assert.deepEqual(validateViewLayout(undefined), []);
  assert.deepEqual(validateViewLayout('not a layout'), []);
});

// --- must catch the verified traps ----------------------------------------

await check('a select without selectionType is caught', () => {
  const { selectionType, ...bad } = goodSelect;
  const p = validateViewLayout(layout(bad));
  assert.equal(p.length, 1);
  assert.equal(p[0].field, 'selectionType');
  assert.match(p[0].message, /ENTIRE tile/);
  assert.match(p[0].path, /modeSelector/, 'the offending element should be named');
});

await check('an invalid selectionType value is caught', () => {
  const p = validateViewLayout(layout({ ...goodSelect, selectionType: 'one' }));
  assert.equal(p.length, 1);
  assert.match(p[0].message, /must be 'single' or 'multi'/);
});

await check('values as an object is caught, with the json.array hint', () => {
  const p = validateViewLayout(layout({ ...goodSelect, values: {} }));
  assert.equal(p.length, 1);
  assert.equal(p[0].field, 'values');
  assert.match(p[0].message, /json\.array\(\)/);
});

await check('selectedItems as an object is caught', () => {
  const p = validateViewLayout(layout({ ...goodSelect, selectedItems: {} }));
  assert.equal(p.length, 1);
  assert.equal(p[0].field, 'selectedItems');
});

await check('every bad select is reported, not just the first', () => {
  const { selectionType, ...bad } = goodSelect;
  const p = validateViewLayout(layout(bad, { ...goodSelect, name: 'other', values: {} }));
  assert.equal(p.length, 2);
});

await check('a select nested anywhere is found', () => {
  const { selectionType, ...bad } = goodSelect;
  const p = validateViewLayout({ a: { b: { c: [{ d: [bad] }] } } });
  assert.equal(p.length, 1);
});

// --- modify_device ---------------------------------------------------------

await check('a good viewLayout writes normally', async () => {
  const hc3 = fakeHc3();
  const r = await modifyDevice(hc3, {
    deviceId: 4933,
    properties: { viewLayout: layout(goodSelect) },
  });
  assert.equal(r.verified, true);
  assert.ok(hc3.calls.some(c => c.method === 'PUT'));
});

await check('a bad viewLayout is refused with no PUT', async () => {
  const hc3 = fakeHc3();
  const { selectionType, ...bad } = goodSelect;
  await assert.rejects(
    () => modifyDevice(hc3, { deviceId: 4933, properties: { viewLayout: layout(bad) } }),
    /refuses this viewLayout/
  );
  assert.equal(hc3.calls.filter(c => c.method === 'PUT').length, 0, 'nothing may be written');
});

await check('the refusal names the field and the escape hatch', async () => {
  const { selectionType, ...bad } = goodSelect;
  await assert.rejects(
    () => modifyDevice(fakeHc3(), { deviceId: 4933, properties: { viewLayout: layout(bad) } }),
    e => {
      assert.match(e.message, /selectionType/);
      assert.match(e.message, /allowUnsafeViewLayout=true/);
      assert.match(e.message, /Nothing was written/);
      return true;
    }
  );
});

await check('allowUnsafeViewLayout=true writes anyway', async () => {
  const hc3 = fakeHc3();
  const { selectionType, ...bad } = goodSelect;
  const r = await modifyDevice(hc3, {
    deviceId: 4933,
    properties: { viewLayout: layout(bad) },
    allowUnsafeViewLayout: true,
  });
  assert.equal(r.verified, true);
  assert.ok(hc3.calls.some(c => c.method === 'PUT'));
});

await check('writes that do not touch viewLayout are unaffected', async () => {
  const hc3 = fakeHc3();
  const r = await modifyDevice(hc3, { deviceId: 4933, topLevel: { name: 'Watering' } });
  assert.equal(r.verified, true);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll viewLayout checks passed');
process.exit(failures ? 1 : 0);
