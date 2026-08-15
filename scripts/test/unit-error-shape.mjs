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
// ---------------------------------------------------------------------------
// 4.21.0 — the finding nudge, and where it must NOT appear.
//
// An error is the moment a finding is cheapest to write and likeliest to be
// skipped. But firing the prompt on every refusal would fill the friction log
// with the guards working correctly and train everyone to ignore the line.
// ---------------------------------------------------------------------------

const { invitesAFinding } = await import('../../out/mcp/friction.js');

check('a gateway error invites a finding', () => {
  assert.ok(invitesAFinding('create_scene', 'HTTP 400: Bad Request - {"reason":"SceneValidationError"}'));
  assert.ok(invitesAFinding('get_device_info', 'HTTP 500: Internal Server Error'));
});

check('a post-write verification failure invites one, despite naming its tool', () => {
  // The case that must not be missed: the write said yes, the read-back said
  // no. This server phrases it, so it looks local, but it is exactly the class
  // the whole server exists to catch.
  assert.ok(invitesAFinding('create_scene', 'create_scene: post-create name mismatch. Submitted "a", stored "b".'));
  assert.ok(invitesAFinding('modify_device', 'modify_device: write did not verify — properties.icon still reads the old value.'));
});

check('a deliberate refusal does NOT invite one', () => {
  // These are the tool working: it saw a call it knew was wrong and said so.
  assert.ok(!invitesAFinding('upload_icon', 'upload_icon: category "device" requires deviceTemplate — the Fibaro device type...'));
  assert.ok(!invitesAFinding('create_scene', 'create_scene: `conditions` must be a Lua source STRING, not a object.'));
  assert.ok(!invitesAFinding('patch_quickapp_file', 'patch_quickapp_file: `old` matched 3 times, expected 1. Nothing was written.'));
});

check('configuration and routing errors do NOT invite one', () => {
  assert.ok(!invitesAFinding('get_devices', 'Fibaro HC3 not configured.'));
  assert.ok(!invitesAFinding('nope', 'Unknown tool: nope'));
});

check('an unexpected internal error invites one', () => {
  assert.ok(invitesAFinding('get_scene', 'Cannot read properties of undefined (reading \'content\')'));
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll error-shape checks passed');
process.exit(failures ? 1 : 0);
