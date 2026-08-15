#!/usr/bin/env node
// get_hc3_api_notes serves two cross-cutting references.
//
// The dead-endpoints half is READ FROM KNOWN_DEAD_ENDPOINTS.md at call time
// rather than copied into TypeScript, so the thing worth testing is not the
// prose but the plumbing: that the file is found from the compiled location,
// that `all` resolves the getter instead of handing back a lazy accessor that
// never fires over JSON-RPC, and that an unreadable file degrades to a message
// saying so rather than to an empty section that reads like "there are none".
//
// That last one matters more than it looks. This tool exists because the server
// instructions pointed every session at a filename no client could open; a
// silent empty answer would be the same failure wearing a better disguise.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { docs } = await import(resolve(ROOT, 'out/mcp/tools/docs.js'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

await check('dead_endpoints is served from the shipped markdown, not a copy', async () => {
  const r = await docs.handlers.get_hc3_api_notes(null, { topic: 'dead_endpoints' });
  const onDisk = readFileSync(resolve(ROOT, 'KNOWN_DEAD_ENDPOINTS.md'), 'utf8');
  assert.equal(r.section.content, onDisk, 'served content differs from the file — a copy has crept in');
  assert.ok(r.section.content.length > 1000, 'suspiciously short');
});

await check('the served copy still describes real dead endpoints', async () => {
  const r = await docs.handlers.get_hc3_api_notes(null, { topic: 'dead_endpoints' });
  // Sampled from the file's own headings. If these vanish, either the file was
  // gutted or the wrong file is being read.
  assert.match(r.section.content, /501/);
  assert.match(r.section.content, /\/api\/quickApp/);
});

await check('silent_writes carries the rule AND the limit of the defence', async () => {
  const r = await docs.handlers.get_hc3_api_notes(null, { topic: 'silent_writes' });
  const t = r.section.content;
  assert.match(t, /does not throw has not necessarily worked/);
  // The catalogue is only half the value; the other half is knowing that this
  // server's read-back verification CANNOT catch a faithful store that is
  // never acted on. Losing that sentence would make the tool reassuring.
  assert.match(t, /cannot catch/i);
  assert.match(t, /caches the value without\s+transmitting/);
});

await check('silent_writes names the instances that cost real time here', async () => {
  const { content } = (await docs.handlers.get_hc3_api_notes(null, { topic: 'silent_writes' })).section;
  for (const instance of [/setGlobalVariable/, /selectionType/, /deviceIcon/, /uiCallbacks/, /1888/]) {
    assert.match(content, instance);
  }
});

await check('all resolves the getter rather than returning an accessor', async () => {
  const r = await docs.handlers.get_hc3_api_notes(null, {});
  assert.equal(typeof r.sections.dead_endpoints.content, 'string');
  assert.equal(typeof r.sections.silent_writes.content, 'string');
  assert.ok(r.sections.dead_endpoints.content.length > 1000);
});

await check('an unknown topic lists what is available instead of throwing', async () => {
  const r = await docs.handlers.get_hc3_api_notes(null, { topic: 'nonsense' });
  assert.deepEqual(r.available_topics, ['silent_writes', 'dead_endpoints']);
});

await check('no arguments at all is treated as "all", not as a crash', async () => {
  const r = await docs.handlers.get_hc3_api_notes(null, undefined);
  assert.ok(r.sections, 'expected the full set');
});

await check('the server instruction points at this tool, not at a bare filename', async () => {
  // The whole reason this tool exists: the instructions named a file that no
  // client can open. If someone reverts to the filename, this catches it.
  const src = readFileSync(resolve(ROOT, 'src/mcp/hc3-mcp-server.ts'), 'utf8');
  const line = src.split('\n').find(l => l.includes('documented endpoints return 501'));
  assert.ok(line, 'the dead-endpoint instruction line has gone missing');
  assert.match(line, /get_hc3_api_notes/);
  assert.ok(
    !/KNOWN_DEAD_ENDPOINTS\.md lists them/.test(line),
    'the instructions again point at a file the client cannot read',
  );
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll api-notes checks passed');
process.exit(failures ? 1 : 0);
