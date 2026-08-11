#!/usr/bin/env node
// Unit test — how tool failures leave the server.
//
// Tool EXECUTION errors must come back as a normal result carrying
// isError:true with the message in content, NOT as a JSON-RPC protocol
// error. Protocol errors are for protocol faults, and many clients render
// them as a generic envelope that discards the text — which is how a user
// spent two days seeing only "Error occurred during tool execution" while
// this server was already reporting HTTP status and HC3's response body.
//
// Protocol-level faults (unknown method, bad params) must still be real
// JSON-RPC errors; this test asserts both halves of that split.
//
//   node scripts/test/unit-error-shape.mjs

import { MCPClient } from './mcp-client.mjs';
import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../out/mcp/hc3-mcp-server.js');
// Stub credentials so the "not configured" guard passes and validation
// reaches the tool's own boundary checks. No HC3 is contacted: the case
// under test is rejected before any request is made.
process.env.FIBARO_HOST = process.env.FIBARO_HOST || 'stub';
process.env.FIBARO_USERNAME = process.env.FIBARO_USERNAME || 'stub';
process.env.FIBARO_PASSWORD = process.env.FIBARO_PASSWORD || 'stub';
const client = new MCPClient({ serverPath: SERVER });
await client.initialize();

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// A tool that rejects at its own boundary, with no HC3 contact needed.
const res = await client.rpc('tools/call', {
  name: 'upload_icon',
  arguments: { category: 'device', mime: 'image/png', base64: 'AAAA' },
});

check('a tool failure is NOT a JSON-RPC protocol error', () => {
  assert.ok(!res.error, `got protocol error ${JSON.stringify(res.error)}`);
  assert.ok(res.result, 'expected a result envelope');
});

check('it is flagged isError', () => {
  assert.equal(res.result.isError, true);
});

check('the message survives verbatim in content', () => {
  const text = res.result.content?.[0]?.text ?? '';
  assert.match(text, /deviceTemplate/, 'the specific reason was lost');
  assert.ok(text.length > 40, `too terse to act on: ${JSON.stringify(text)}`);
});

check('a successful call is not flagged isError', () => {
  // get_server_info makes no HC3 round-trip, so it works without a gateway.
  return client.rpc('tools/call', { name: 'get_server_info', arguments: {} }).then(ok => {
    assert.ok(!ok.error);
    assert.notEqual(ok.result.isError, true);
    assert.ok(ok.result.content?.[0]?.text?.includes('hc3-mcp-server'));
  });
});

// Protocol faults stay protocol faults.
const bad = await client.rpc('nonexistent/method', {});
check('an unknown method IS still a protocol error', () => {
  assert.ok(bad.error, 'expected a JSON-RPC error');
  assert.equal(bad.error.code, -32601);
});

const badUri = await client.rpc('resources/read', {});
check('a malformed resources/read IS still a protocol error', () => {
  assert.ok(badUri.error);
  assert.equal(badUri.error.code, -32602);
});

await new Promise(r => setTimeout(r, 300));
console.log(failures ? `\n${failures} failure(s)` : '\nAll error-shape checks passed');
process.exit(failures ? 1 : 0);
