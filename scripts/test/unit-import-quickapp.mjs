#!/usr/bin/env node
// Unit test — import_quickapp. No live HC3: fetch is stubbed to capture the
// multipart body, and the client is faked for the post-import verify.
//
// import_quickapp was a stub that threw unconditionally ("not yet
// implemented") until 4.9.0. It now posts multipart/form-data to
// /api/quickApp/import with `file` and optional `roomId` parts, and accepts
// the .fqa as base64 so a remote client can import without shell access to
// the machine running the server.
//
//   node scripts/test/unit-import-quickapp.mjs

import { quickapps } from '../../out/mcp/tools/quickapps.js';
import { strict as assert } from 'node:assert';

const importQa = quickapps.handlers.import_quickapp;
const CONFIG = { host: '192.0.2.10', port: 80, username: 'u', password: 'p' };
const realFetch = globalThis.fetch;

const FQA = JSON.stringify({ name: 'Watering', type: 'com.fibaro.genericDevice', files: [] });
const B64 = Buffer.from(FQA, 'utf8').toString('base64');

function fakeHc3(device = { id: 4937, name: 'Watering', type: 'com.fibaro.genericDevice', roomID: 219 }) {
  return {
    config: CONFIG,
    async request(endpoint) {
      assert.equal(endpoint, `/api/devices/${device.id}`);
      return device;
    },
  };
}

function stubFetch(reply = { ok: true, status: 200, json: { id: 4937 } }) {
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = url;
    seen.contentType = init.headers['Content-Type'];
    seen.body = Buffer.from(init.body).toString('binary');
    return {
      ok: reply.ok,
      status: reply.status,
      async json() { return reply.json; },
      async text() { return reply.text ?? JSON.stringify(reply.json); },
    };
  };
  return seen;
}

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

await check('posts the .fqa to /api/quickApp/import as a file part', async () => {
  const seen = stubFetch();
  const r = await importQa(fakeHc3(), { base64: B64 });
  assert.match(seen.url, /\/api\/quickApp\/import$/);
  assert.match(seen.contentType, /^multipart\/form-data; boundary=/);
  assert.equal(parts(seen.body).file, FQA, 'file part must carry the .fqa bytes verbatim');
  assert.match(seen.body, /name="file"; filename="import\.fqa"/);
  assert.equal(r.deviceId, 4937);
  assert.equal(r.source, 'base64');
});

await check('roomId is sent only when supplied', async () => {
  let seen = stubFetch();
  await importQa(fakeHc3(), { base64: B64, roomId: 219 });
  assert.equal(parts(seen.body).roomId, '219');

  seen = stubFetch();
  await importQa(fakeHc3(), { base64: B64 });
  assert.ok(!/name="roomId"/.test(seen.body), 'roomId part must be absent when not supplied');
});

await check('roomId 0 is still sent (not swallowed as falsy)', async () => {
  const seen = stubFetch();
  await importQa(fakeHc3(), { base64: B64, roomId: 0 });
  assert.equal(parts(seen.body).roomId, '0');
});

await check('fileName override reaches the multipart part', async () => {
  const seen = stubFetch();
  await importQa(fakeHc3(), { base64: B64, fileName: 'Watering.fqa' });
  assert.match(seen.body, /filename="Watering\.fqa"/);
});

await check('body ends with the closing boundary', async () => {
  const seen = stubFetch();
  await importQa(fakeHc3(), { base64: B64 });
  const boundary = seen.contentType.split('boundary=')[1];
  assert.ok(seen.body.endsWith(`--${boundary}--\r\n`));
});

await check('exactly one of base64 / filePath is required', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('unreachable'); };
  await assert.rejects(() => importQa(fakeHc3(), {}), /exactly one of base64 or filePath/);
  await assert.rejects(
    () => importQa(fakeHc3(), { base64: B64, filePath: '/tmp/x.fqa' }),
    /exactly one of base64 or filePath/,
  );
  assert.equal(fetched, false, 'must not POST when the pre-check fails');
});

await check('the refusal steers remote callers to base64', async () => {
  await assert.rejects(() => importQa(fakeHc3(), {}), /resolved on the host running this MCP server/);
});

await check('a non-JSON payload is rejected before posting', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('unreachable'); };
  await assert.rejects(
    () => importQa(fakeHc3(), { base64: Buffer.from('not json').toString('base64') }),
    /not valid JSON/,
  );
  assert.equal(fetched, false);
});

await check('JSON that is not a .fqa is rejected', async () => {
  await assert.rejects(
    () => importQa(fakeHc3(), { base64: Buffer.from('{"hello":1}').toString('base64') }),
    /neither a "name" nor a "type"/,
  );
});

await check('a .fqa with only a type key is accepted', async () => {
  stubFetch();
  const r = await importQa(fakeHc3(), { base64: Buffer.from('{"type":"com.fibaro.genericDevice"}').toString('base64') });
  assert.equal(r.deviceId, 4937);
});

await check('an unreadable server-side path names the file and the side', async () => {
  await assert.rejects(
    () => importQa(fakeHc3(), { filePath: '/definitely/not/here.fqa' }),
    /could not read '\/definitely\/not\/here\.fqa' on the MCP server host/,
  );
  await assert.rejects(
    () => importQa(fakeHc3(), { filePath: '/definitely/not/here.fqa' }),
    /pass it as base64 instead/,
  );
});

await check("HC3's reason and message surface on failure", async () => {
  stubFetch({ ok: false, status: 400, text: '{"type":"ERROR","reason":"Cannot import quick app file","message":"bad"}' });
  await assert.rejects(
    () => importQa(fakeHc3(), { base64: B64 }),
    (e) => /HTTP 400/.test(e.message) && /Cannot import quick app file/.test(e.message),
  );
});

await check('403 explains the gateway-encryption case', async () => {
  stubFetch({ ok: false, status: 403, text: '{"reason":"forbidden"}' });
  await assert.rejects(() => importQa(fakeHc3(), { base64: B64 }), /encrypted for a different gateway/);
});

await check('a 2xx with no device id is treated as a failure', async () => {
  stubFetch({ ok: true, status: 200, json: { ok: true } });
  await assert.rejects(() => importQa(fakeHc3(), { base64: B64 }), /returned no device id/);
});

await check('post-import verify refetches the device and checks the id', async () => {
  stubFetch({ ok: true, status: 200, json: { id: 4937 } });
  const wrongDevice = { config: CONFIG, async request() { return { id: 9999 }; } };
  await assert.rejects(() => importQa(wrongDevice, { base64: B64 }), /refetching it did not return that device/);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll import_quickapp checks passed');
process.exit(failures ? 1 : 0);
