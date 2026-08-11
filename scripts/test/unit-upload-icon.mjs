#!/usr/bin/env node
// Unit test — upload_icon. No live HC3: stubs global fetch to capture the
// multipart body and injects a fake client for the before/after /api/icons
// listings.
//
// Regression cover for the 11 Aug 2026 bug report: every device-category
// upload failed with HTTP 400 MISSING_PARAMETER because HC3 requires a
// `deviceTemplate` part for device icons (they are filed per device type)
// and the tool never sent one. Room and scene icons must NOT carry it.
//
//   node scripts/test/unit-upload-icon.mjs

import { icons } from '../../out/mcp/tools/icons.js';
import { strict as assert } from 'node:assert';

const uploadIcon = icons.handlers.upload_icon;

// Minimal buffer that satisfies upload_icon's PNG header pre-checks. Only the
// signature and IHDR fields are read, so the rest can be zeroes.
function makePng({ width = 128, height = 128, bitDepth = 8, colorType = 3 } = {}) {
  const b = Buffer.alloc(40);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0);
  b.write('IHDR', 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b.writeUInt8(bitDepth, 24);
  b.writeUInt8(colorType, 25);
  return b.toString('base64');
}

const PNG = makePng();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');

// Fake client: first /api/icons call is "before", second is "after" with the
// freshly-assigned icon appended.
function fakeHc3() {
  let listCalls = 0;
  return {
    config: { host: '10.0.1.3', port: 80, username: 'u', password: 'p' },
    async request(endpoint) {
      assert.equal(endpoint, '/api/icons');
      listCalls++;
      const base = {
        device: [{ id: 300, deviceType: 'com.fibaro.binarySwitch', iconSetName: 'ButtonSwitchV2', fileExtension: 'svg' }],
        room: [{ id: 100, iconName: 'Armchair', fileExtension: 'svg' }],
        scene: [{ id: 200, iconName: 'Scene1', fileExtension: 'svg' }],
      };
      if (listCalls === 1) return base;
      return {
        device: [...base.device, { id: 1026, deviceType: 'com.fibaro.binarySwitch', iconSetName: 'User1026', fileExtension: 'png' }],
        room: [...base.room, { id: 1026, iconName: 'User1026', fileExtension: 'png' }],
        scene: [...base.scene, { id: 1026, iconName: 'User1026', fileExtension: 'png' }],
      };
    },
  };
}

// Swap global fetch for one that records the request and replies with `reply`.
function stubFetch(reply = { ok: true, status: 200, body: '{"id":1026}' }) {
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = url;
    seen.contentType = init.headers['Content-Type'];
    seen.body = Buffer.from(init.body).toString('binary');
    return {
      ok: reply.ok,
      status: reply.status,
      async text() { return reply.body; },
    };
  };
  return seen;
}
const realFetch = globalThis.fetch;

// Parse the multipart body into {partName: value}. Good enough for text parts.
function parts(body) {
  const out = {};
  for (const m of body.matchAll(/Content-Disposition: form-data; name="([^"]+)"([^\r\n]*)\r\n(?:Content-Type: [^\r\n]+\r\n)?\r\n([\s\S]*?)\r\n--/g)) {
    out[m[1]] = m[3];
  }
  return out;
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  finally { globalThis.fetch = realFetch; }
}

await check('device upload sends a deviceTemplate part (the reported bug)', async () => {
  const seen = stubFetch();
  const r = await uploadIcon(fakeHc3(), {
    base64: PNG, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  const p = parts(seen.body);
  assert.equal(p.deviceTemplate, 'com.fibaro.binarySwitch', 'deviceTemplate part missing or wrong');
  assert.equal(p.type, 'device');
  assert.equal(p.fileExtension, 'png');
  assert.equal(r.newName, 'User1026');
  assert.equal(r.deviceTemplate, 'com.fibaro.binarySwitch');
});

await check('device upload without deviceTemplate is refused before any HC3 contact', async () => {
  stubFetch();
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('should not be reached'); };
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'device' }),
    /requires deviceTemplate/,
  );
  assert.equal(fetched, false, 'must not POST when the pre-check fails');
});

await check('the refusal names a usable example device type', async () => {
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'device' }),
    /com\.fibaro\.binarySwitch/,
  );
});

await check('room upload omits deviceTemplate entirely', async () => {
  const seen = stubFetch();
  await uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'room' });
  assert.ok(!/deviceTemplate/.test(seen.body), 'room body must not carry a deviceTemplate part');
  assert.equal(parts(seen.body).type, 'room');
});

await check('deviceTemplate on a room upload is refused', async () => {
  await assert.rejects(
    () => uploadIcon(fakeHc3(), {
      base64: PNG, mime: 'image/png', category: 'room', deviceTemplate: 'com.fibaro.binarySwitch',
    }),
    /only applies to category "device"/,
  );
});

await check('multipart framing: file part keeps filename and content type', async () => {
  const seen = stubFetch();
  await uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'room' });
  assert.match(seen.body, /name="icon"; filename="mcp\.png"\r\nContent-Type: image\/png/);
  assert.match(seen.contentType, /^multipart\/form-data; boundary=/);
  const boundary = seen.contentType.split('boundary=')[1];
  assert.ok(seen.body.endsWith(`--${boundary}--\r\n`), 'body must end with the closing boundary');
});

await check("HC3's reason and message surface in the thrown error", async () => {
  stubFetch({
    ok: false, status: 400,
    body: '{"type":"ERROR","reason":"MISSING_PARAMETER","message":"deviceTemplate: missing required parameter"}',
  });
  await assert.rejects(
    () => uploadIcon(fakeHc3(), {
      base64: PNG, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
    }),
    (e) => /HTTP 400/.test(e.message)
      && /MISSING_PARAMETER/.test(e.message)
      && /missing required parameter/.test(e.message),
  );
});

await check('a non-JSON error body still reaches the caller verbatim', async () => {
  stubFetch({ ok: false, status: 502, body: '<html>bad gateway</html>' });
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'room' }),
    /HTTP 502.*bad gateway/s,
  );
});

await check('an empty error body is reported as such, not as silence', async () => {
  stubFetch({ ok: false, status: 403, body: '' });
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'room' }),
    /HTTP 403.*\(empty body\)/,
  );
});

await check('PNG shape pre-checks still bite (wrong size, wrong colour type)', async () => {
  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: makePng({ width: 64, height: 64 }), mime: 'image/png', category: 'room' }),
    /must be 128x128/,
  );
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: makePng({ colorType: 6 }), mime: 'image/png', category: 'room' }),
    /must be palette mode/,
  );
});

await check('SVG skips the PNG pre-checks and uploads as-is', async () => {
  const seen = stubFetch();
  const r = await uploadIcon(fakeHc3(), {
    base64: SVG, mime: 'image/svg+xml', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.equal(r.extension, 'svg');
  assert.equal(parts(seen.body).fileExtension, 'svg');
  assert.match(seen.body, /filename="mcp\.svg"/);
});

await check('hint is category-aware (device attaches by numeric id)', async () => {
  stubFetch();
  const dev = await uploadIcon(fakeHc3(), {
    base64: PNG, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.match(dev.hint, /modify_device/);
  assert.match(dev.hint, /deviceIcon: 1026/);

  stubFetch();
  const room = await uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'room' });
  assert.match(room.hint, /modify_room/);
  assert.ok(!('deviceTemplate' in room), 'room result must not carry deviceTemplate');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll upload_icon checks passed');
process.exit(failures ? 1 : 0);
