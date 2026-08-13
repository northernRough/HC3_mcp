#!/usr/bin/env node
// Unit test — the initialize `instructions` field.
//
// Instructions reach the client before any tool is chosen, so they are the
// only channel that lands at design time. They are also the most expensive
// place to be wrong: every session pays for them and nobody can opt out.
//
// These checks therefore guard the BAR as much as the field. Each asserted
// claim below was verified against a live gateway on 2026-08-11; an earlier
// draft asserted the opposite of two of them, straight from Fibaro's spec.
// If one of these tests starts failing because the text changed, confirm the
// new claim on the wire before updating the test to match.
//
//   node scripts/test/unit-instructions.mjs

import { MCPClient } from './mcp-client.mjs';
import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '../../out/mcp/hc3-mcp-server.js');
const client = new MCPClient({ serverPath: SERVER });
const init = await client.initialize();
const text = init.result?.instructions;

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

check('initialize returns an instructions string', () => {
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 200, `too short to be useful (${text?.length})`);
});

check('it stays within a sane context budget', () => {
  // Injected into every session. Past ~3 KB it stops being a summary.
  assert.ok(text.length < 3000, `${text.length} chars — trim it`);
});

check('carries the placeholder-not-404 rule', () => {
  assert.match(text, /200 with a placeholder/);
  assert.match(text, /1888/);
});

check('carries the per-device-type icon set model', () => {
  assert.match(text, /genericDevice/);
  assert.match(text, /binarySwitch/);
  assert.match(text, /multilevelSwitch/);
  // The value-driven switch is the fact that changes how you design a QA.
  assert.match(text, /from the device value/);
});

check('does NOT repeat the two claims that were wrong', () => {
  // 4.12.0 asserted device icons were single-image sets and that every state
  // change had to be code-driven. Both false. Guard against reintroduction.
  assert.ok(!/single-image set/i.test(text), 'the disproven single-image claim is back');
  assert.ok(!/palette/i.test(text), 'the disproven palette requirement is back');
  assert.ok(!/every state change is code-driven/i.test(text));
});

check('states the size rule and that colour type is irrelevant', () => {
  assert.match(text, /128x128/);
  assert.match(text, /INVALID_ICON_SIZE/);
  assert.match(text, /[Cc]olour type does NOT matter|RGBA is fine/);
});

check('warns that icon names collide across buckets', () => {
  assert.match(text, /unique only WITHIN a bucket/);
});

check('points at get_scene over get_scenes', () => {
  assert.match(text, /get_scenes/);
  assert.match(text, /use get_scene/);
});

// A caller who already knows update_quickapp_file will never find the patch
// tool on its own — whole-file rewriting looks like it works right up until
// the file is too big to express.
check('points at the patch tools over rewriting a body whole', () => {
  assert.match(text, /patch_quickapp_file/);
  assert.match(text, /patch_scene_content/);
  assert.match(text, /no longer fits/);
});

check('mentions the partial-read arguments', () => {
  assert.match(text, /startLine\/endLine or contains/);
});

check('tells the reader to reconnect after a redeploy', () => {
  assert.match(text, /cache tool schemas at connect/);
});

check('advertises the resources by uri', () => {
  for (const uri of ['hc3://health', 'hc3://watchdog', 'hc3://binder', 'hc3://globals']) {
    assert.ok(text.includes(uri), `missing ${uri}`);
  }
});

check('carries the select trap, which reports verified then blanks the tile', () => {
  // Confirmed here on 2026-08-12 by running the reporter's reproduction:
  // one device, external modify_device PUT only, one field varying.
  // No selectionType -> getView returned 0 components (the label vanished
  // too); adding selectionType alone -> both components rendered.
  assert.match(text, /selectionType/);
  assert.match(text, /entire\*\* tile|entire tile/);
});

check('does NOT claim a QuickApp must install its own view', () => {
  // The reporter withdrew this after testing: an externally-PUT viewLayout
  // renders fine. It was never adopted here; this guards against it being
  // added later from the original report.
  assert.ok(!/install its own view|must install.*viewLayout/i.test(text));
});

check('invites findings, with the one-variable bar stated', () => {
  assert.match(text, /report_finding/);
  assert.match(text, /one-variable reproduction/);
});

check('makes no claim this session did not verify', () => {
  // uiCallbacks and Z-Wave transmission are reported/inherited, not tested
  // here. They belong in a tool description, not in every session's context.
  assert.ok(!/uiCallbacks/.test(text), 'unverified uiCallbacks claim promoted to instructions');
  assert.ok(!/setConfiguration/.test(text), 'unverified Z-Wave claim promoted to instructions');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll instructions checks passed');
process.exit(failures ? 1 : 0);
