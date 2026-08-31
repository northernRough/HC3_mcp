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
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { realPng, realPng64, corruptOneByte } from './png-fixture.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const uploadIcon = icons.handlers.upload_icon;

// Real PNGs, not header stubs: upload_icon now walks every chunk, checks its
// CRC32 and inflates the IDAT, so a fixture that no decoder would accept
// cannot tell us whether the validator accepts valid files. See png-fixture.mjs.
const makePng = (opts = {}) => realPng64({ colorType: 3, ...opts });

const PNG = makePng();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
// Device icons are state sets: HC3 stores User<N>0.png / User<N>100.png and
// picks by device value. A single unsuffixed image renders blank, so the tool
// refuses it — hence every device case here supplies states.
const STATES = { '0': PNG, '100': PNG };
const SVG_STATES = { '0': SVG, '100': SVG };

// Fake client: first /api/icons call is "before", second is "after" with the
// freshly-assigned icon appended.
function fakeHc3() {
  let listCalls = 0;
  return {
    config: { host: '192.0.2.10', port: 80, username: 'u', password: 'p' },
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
    states: STATES, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  const p = parts(seen.body);
  assert.equal(p.deviceTemplate, 'com.fibaro.binarySwitch', 'deviceTemplate part missing or wrong');
  assert.equal(p.type, 'device');
  assert.equal(p.fileExtension, 'png');
  assert.equal(r.newName, 'User1026');
  assert.equal(r.deviceTemplate, 'com.fibaro.binarySwitch');
  assert.deepEqual(r.states, ['0', '100']);
});

await check('device states become icon0 / icon100 parts, ascending', async () => {
  const seen = stubFetch();
  await uploadIcon(fakeHc3(), {
    states: { '100': PNG, '0': PNG, '50': PNG },   // deliberately out of order
    // A type with no entry in DEVICE_STATE_MODEL, so an arbitrary set is
    // accepted and this test stays about part naming, not the state model.
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.FGRGBW442CC',
  });
  assert.match(seen.body, /name="icon0"/);
  assert.match(seen.body, /name="icon50"/);
  assert.match(seen.body, /name="icon100"/);
  assert.ok(!/name="icon"[^0-9]/.test(seen.body), 'must not send a bare "icon" part for a device set');
  const order = [...seen.body.matchAll(/name="icon(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(order, [0, 50, 100], 'state parts should be ascending');
});

await check('a device upload with a single image is refused', async () => {
  let posted = false;
  globalThis.fetch = async () => { posted = true; throw new Error('unreachable'); };
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch' }),
    /renders BLANK/,
  );
  assert.equal(posted, false, 'must not POST an icon that cannot render');
});

await check('every state image is validated before any upload', async () => {
  let posted = false;
  globalThis.fetch = async () => { posted = true; throw new Error('unreachable'); };
  await assert.rejects(
    () => uploadIcon(fakeHc3(), {
      states: { '0': PNG, '100': makePng({ width: 64, height: 64 }) },
      mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
    }),
    /state '100' must be 128x128/,
  );
  assert.equal(posted, false, 'one bad frame must fail the whole set before writing');
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
      states: STATES, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
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

await check('the 128x128 pre-check still bites', async () => {
  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: makePng({ width: 64, height: 64 }), mime: 'image/png', category: 'room' }),
    /must be 128x128/,
  );
});

await check('RGBA is accepted — HC3 does NOT require palette mode', async () => {
  // The inherited claim that HC3 silent-500s on RGB/RGBA is false. An RGBA
  // PNG uploads with HTTP 201, is stored byte-identical and renders, and
  // every user icon already on a live gateway is colour type 6. Refusing it
  // rejected exactly the format the gateway itself uses.
  stubFetch();
  const r = await uploadIcon(fakeHc3(), { base64: makePng({ colorType: 6 }), mime: 'image/png', category: 'room' });
  assert.equal(r.newName, 'User1026');

  stubFetch();
  const grey = await uploadIcon(fakeHc3(), { base64: makePng({ colorType: 0 }), mime: 'image/png', category: 'room' });
  assert.equal(grey.newName, 'User1026');
});

await check('SVG skips the PNG pre-checks and uploads as-is', async () => {
  const seen = stubFetch();
  const r = await uploadIcon(fakeHc3(), {
    states: SVG_STATES, mime: 'image/svg+xml', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.equal(r.extension, 'svg');
  assert.equal(parts(seen.body).fileExtension, 'svg');
  assert.match(seen.body, /filename="mcp0\.svg"/);
});

await check('hint is category-aware (device attaches by numeric id)', async () => {
  stubFetch();
  const dev = await uploadIcon(fakeHc3(), {
    states: STATES, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.match(dev.hint, /modify_device/);
  assert.match(dev.hint, /deviceIcon: 1026/);

  stubFetch();
  const room = await uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'room' });
  assert.match(room.hint, /modify_room/);
  assert.ok(!('deviceTemplate' in room), 'room result must not carry deviceTemplate');
});

await check('every source states the properties.icon discard as conditional', async () => {
  // 4.25.0 walked this claim back: an external `api.put` of `properties.icon`
  // PERSISTS on an idle throwaway QA, so the endpoint is not what drops it.
  // api-notes.ts and quickapp-programming.ts were corrected; upload_icon's
  // description was missed and shipped the flat "silently discarded" claim for
  // a release, so the package answered differently depending on which you read.
  //
  // Guarding the class rather than the instance: any shipped source that
  // discusses the external write must carry the conditional with it.
  const sources = [
    'src/mcp/tools/icons.ts',
    'src/mcp/docs/api-notes.ts',
    'src/mcp/docs/quickapp-programming.ts',
  ];
  for (const rel of sources) {
    const text = readFileSync(resolve(ROOT, rel), 'utf8');
    if (!text.includes('properties.icon')) continue;
    assert.ok(
      /persists/i.test(text),
      `${rel} discusses an external properties.icon write without the idle-QA finding that qualifies it`,
    );
    assert.ok(
      !/silently discarded/.test(text),
      `${rel} again claims the write is silently discarded; probed on an idle QA it persists`,
    );
  }
});

await check('upload_icon hashes the bytes it actually POSTed', async () => {
  // The hash has to be of the decoded bytes HC3 received, so a caller who
  // hashed the same file locally sees a corrupt paste HERE rather than on a
  // phone once the tile renders. Mirrors the input shape: md5 for base64,
  // statesMd5 for a set.
  stubFetch();
  const single = await uploadIcon(fakeHc3(), { base64: PNG, mime: 'image/png', category: 'room' });
  assert.equal(single.md5, createHash('md5').update(Buffer.from(PNG, 'base64')).digest('hex'));
  assert.ok(!('statesMd5' in single), 'a single image must not report a state map');

  stubFetch();
  const set = await uploadIcon(fakeHc3(), {
    states: STATES, mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.ok(!('md5' in set), 'a state set must not report a single hash');
  assert.deepEqual(Object.keys(set.statesMd5).sort(), ['0', '100']);
  assert.equal(
    set.statesMd5['0'],
    createHash('md5').update(Buffer.from(STATES['0'], 'base64')).digest('hex'),
  );
});

await check('differing state images produce differing hashes', async () => {
  // A hash that stayed constant across different images would satisfy every
  // other assertion here and catch nothing, which is the whole point.
  stubFetch();
  const set = await uploadIcon(fakeHc3(), {
    states: { '0': makePng({ colorType: 3 }), '100': makePng({ colorType: 6 }) },
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.notEqual(set.statesMd5['0'], set.statesMd5['100']);
});

await check('a one-byte substitution is refused, and the damaged chunk is named', async () => {
  // The failure the whole validator exists for. Length is unchanged, so every
  // size-based check agrees; only the chunk CRC sees it. The error has to name
  // the chunk and its byte range, because "this PNG is corrupt" sends someone
  // back to re-copy 15 KB while a byte range points at the part that is wrong.
  const clean = realPng();
  const idatOffset = clean.indexOf(Buffer.from('IDAT', 'latin1'));
  const damaged = corruptOneByte(clean, idatOffset + 12);
  assert.equal(damaged.length, clean.length, 'the premise: substitution does not change length');

  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: damaged.toString('base64'), mime: 'image/png', category: 'room' }),
    (e) => {
      assert.match(e.message, /CRC/i, 'the error must say what kind of damage this is');
      assert.match(e.message, /IDAT/, 'and which chunk carries it');
      assert.match(e.message, /byte/i, 'and where to look');
      return true;
    },
  );
});

await check('damage is caught even when IHDR still reads a plausible 128x128', async () => {
  // Why the structural walk runs BEFORE the dimension check: a corrupt payload
  // usually still parses a valid-looking size out of the header, so a
  // dimensions-only validator waves it through.
  const clean = realPng();
  const damaged = corruptOneByte(clean, clean.length - 12);

  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: damaged.toString('base64'), mime: 'image/png', category: 'room' }),
    (e) => {
      assert.ok(!/must be 128x128/.test(e.message), 'the dimension check must not be what fires here');
      return true;
    },
  );
});

await check('a truncated payload is told to re-fetch, not repaired', async () => {
  // Truncation and substitution need different advice: there is nothing to
  // repair in a file that simply stops.
  const truncated = realPng().subarray(0, 60);

  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: truncated.toString('base64'), mime: 'image/png', category: 'room' }),
    (e) => {
      assert.match(e.message, /truncat/i);
      assert.match(e.message, /re-fetch/i);
      return true;
    },
  );
});

await check('one bad frame fails the set before any of it is written', async () => {
  // upload_icon is a committed write per call, so a state set with a corrupt
  // frame must fail at the boundary rather than half-write a dimmer.
  const clean = realPng64();
  const damaged = corruptOneByte(realPng(), realPng().indexOf(Buffer.from('IDAT', 'latin1')) + 12).toString('base64');

  const seen = stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), {
      states: { '0': clean, '100': damaged },
      mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
    }),
    (e) => {
      assert.match(e.message, /state '100'/, 'the error must name which frame');
      return true;
    },
  );
  assert.ok(!seen.body, 'nothing may be POSTed when a frame is bad');
});

await check('an SVG still bypasses the PNG structural checks', async () => {
  // The validator is PNG-specific; SVG uploads as-is and must not be dragged
  // through a chunk walk it has no chunks for.
  stubFetch();
  const r = await uploadIcon(fakeHc3(), { base64: SVG, mime: 'image/svg+xml', category: 'room' });
  assert.equal(r.extension, 'svg');
});

// The reference form fetches from the gateway, so these need the asset paths
// served as well as the /api/icons listings. stubFetch only answers the POST
// and returns what was sent, so wrap it.
function stubFetchWithAssets(assets = {}) {
  const seen = stubFetch();
  const posted = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const path = new URL(url).pathname;
    if (path.startsWith('/assets/')) {
      const hit = assets[path];
      if (!hit) {
        // What a real gateway does for a missing asset: 200 with its SPA.
        return { ok: true, status: 200, headers: { get: () => 'text/html' },
          async arrayBuffer() { return Buffer.alloc(13047); } };
      }
      return { ok: true, status: 200, headers: { get: () => hit.mime },
        async arrayBuffer() { return hit.body; } };
    }
    return posted(url, opts);
  };
  return seen;
}

await check('fromIcon uploads bytes that never entered the conversation', async () => {
  // The whole point of the reference form: the payload is not transcribed, so
  // it cannot be mistyped. Verified by checking the POSTed bytes equal the
  // served ones rather than anything the caller supplied.
  const served = realPng({ colorType: 2 });
  const seen = stubFetchWithAssets({
    '/assets/userIcons/devices/User1026/User1026.png': { mime: 'image/png', body: served },
  });

  const r = await uploadIcon(fakeHc3(), {
    fromIcon: { icon: 'User1026' }, mime: 'image/png', category: 'room',
  });

  assert.equal(r.md5, createHash('md5').update(served).digest('hex'), 'the uploaded bytes must be the served bytes');
  assert.deepEqual(r.sourcedFrom, { image: 'User1026' }, 'the result must say where the bytes came from');
  assert.ok(seen.body.includes(served.toString('latin1')), 'the served bytes must appear in the multipart body');
});

await check('userIcon is inferred from a User<N> name and obeyed when stated', async () => {
  // User<N> is how HC3 names every uploaded icon, so the inference is right
  // almost always — but a caller who says otherwise has to win.
  const served = realPng();
  stubFetchWithAssets({ '/assets/userIcons/devices/User77/User77.png': { mime: 'image/png', body: served } });
  const inferred = await uploadIcon(fakeHc3(), { fromIcon: { icon: 'User77' }, mime: 'image/png', category: 'room' });
  assert.equal(inferred.md5, createHash('md5').update(served).digest('hex'));

  stubFetchWithAssets({ '/assets/icon/fibaro/light/light.png': { mime: 'image/png', body: served } });
  const builtIn = await uploadIcon(fakeHc3(), { fromIcon: { icon: 'light' }, mime: 'image/png', category: 'room' });
  assert.equal(builtIn.md5, createHash('md5').update(served).digest('hex'));
});

await check('a reference that resolves to a placeholder fails, naming the icon', async () => {
  // HC3 answers 200 with its SPA for a missing asset, so an unchecked fetch
  // would upload 13 KB of HTML as an icon.
  stubFetchWithAssets({});
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { fromIcon: { icon: 'User9999' }, mime: 'image/png', category: 'room' }),
    (e) => {
      assert.match(e.message, /User9999/, 'the error must name the icon that could not be read');
      return true;
    },
  );
});

await check('a referenced SVG under an image/png upload is refused', async () => {
  // Otherwise the gateway ends up with a file whose name and content disagree.
  stubFetchWithAssets({
    '/assets/userIcons/devices/User1026/User1026.svg': {
      mime: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    },
  });
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { fromIcon: { icon: 'User1026', extension: 'svg' }, mime: 'image/png', category: 'room' }),
    /is a \.svg file, but this upload declares \.png/,
  );
});

await check('statesOff/statesOn expands to the full multilevelSwitch set', async () => {
  // Eleven frames from two payloads: state 0 off, 10 through 100 on. This is
  // the case the shorthand exists for.
  const off = realPng64({ colorType: 3 });
  const on = realPng64({ colorType: 6 });
  stubFetch();

  const r = await uploadIcon(fakeHc3(), {
    statesOff: off, statesOn: on,
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.multilevelSwitch',
  });

  assert.deepEqual(r.states, ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100']);
  assert.equal(r.statesMd5['0'], createHash('md5').update(Buffer.from(off, 'base64')).digest('hex'));
  for (const s of ['10', '50', '100']) {
    assert.equal(r.statesMd5[s], createHash('md5').update(Buffer.from(on, 'base64')).digest('hex'));
  }
  assert.notEqual(r.statesMd5['0'], r.statesMd5['100'], 'off and on must not collapse to one image');
});

await check('statesOff/statesOn covers binarySwitch as 0 and 100', async () => {
  stubFetch();
  const r = await uploadIcon(fakeHc3(), {
    statesOff: realPng64({ colorType: 3 }), statesOn: realPng64({ colorType: 6 }),
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });
  assert.deepEqual(r.states, ['0', '100']);
});

await check('the shorthand accepts references, so a set can need no payload at all', async () => {
  const offBytes = realPng({ colorType: 3 });
  const onBytes = realPng({ colorType: 6 });
  stubFetchWithAssets({
    '/assets/userIcons/devices/User10/User10.png': { mime: 'image/png', body: offBytes },
    '/assets/userIcons/devices/User11/User11.png': { mime: 'image/png', body: onBytes },
  });

  const r = await uploadIcon(fakeHc3(), {
    statesOff: { icon: 'User10' }, statesOn: { icon: 'User11' },
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.multilevelSwitch',
  });

  assert.equal(r.statesMd5['0'], createHash('md5').update(offBytes).digest('hex'));
  assert.equal(r.statesMd5['100'], createHash('md5').update(onBytes).digest('hex'));
  assert.equal(r.sourcedFrom['0'], 'User10');
  assert.equal(r.sourcedFrom['100'], 'User11');
});

await check('states may mix a pasted image and a referenced one', async () => {
  const refBytes = realPng({ colorType: 2 });
  const pasted = realPng64({ colorType: 3 });
  stubFetchWithAssets({
    '/assets/userIcons/devices/User10/User100.png': { mime: 'image/png', body: refBytes },
  });

  const r = await uploadIcon(fakeHc3(), {
    states: { '0': pasted, '100': { icon: 'User10', state: 0 } },
    mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
  });

  assert.equal(r.statesMd5['0'], createHash('md5').update(Buffer.from(pasted, 'base64')).digest('hex'));
  assert.equal(r.statesMd5['100'], createHash('md5').update(refBytes).digest('hex'));
  assert.deepEqual(r.sourcedFrom, { '100': 'User10' }, 'only the referenced frame is reported as sourced');
});

await check('half a shorthand is refused rather than leaving states blank', async () => {
  // HC3 renders blank at any state whose file is absent and reports no error,
  // so a half-given shorthand has to fail here.
  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), {
      statesOff: realPng64(), mime: 'image/png',
      category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
    }),
    /statesOff and statesOn are a pair/,
  );
});

await check('the shorthand is refused where the state list is unknown', async () => {
  // It expands from DEVICE_STATE_MODEL, so a type not in that table has no
  // set to expand into. Guessing would produce a silently blank tile.
  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), {
      statesOff: realPng64(), statesOn: realPng64(), mime: 'image/png',
      category: 'device', deviceTemplate: 'com.fibaro.somethingNew',
    }),
    /not one this server knows/,
  );
});

await check('the input forms are mutually exclusive', async () => {
  stubFetch();
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { base64: PNG, fromIcon: { icon: 'User1' }, mime: 'image/png', category: 'room' }),
    /either base64 or fromIcon/,
  );
  await assert.rejects(
    () => uploadIcon(fakeHc3(), {
      states: STATES, statesOff: PNG, statesOn: PNG,
      mime: 'image/png', category: 'device', deviceTemplate: 'com.fibaro.binarySwitch',
    }),
    /either states .* or statesOff\/statesOn/,
  );
  await assert.rejects(
    () => uploadIcon(fakeHc3(), { statesOff: PNG, statesOn: PNG, mime: 'image/png', category: 'room' }),
    /do not apply to category "room"/,
  );
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll upload_icon checks passed');
process.exit(failures ? 1 : 0);
