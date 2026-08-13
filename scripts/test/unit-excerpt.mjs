#!/usr/bin/env node
// Unit test — partial reads: the excerpt primitive plus the get_quickapp_file
// and get_scene paths that use it, and the contentHash both getters now return.
//
//   node scripts/test/unit-excerpt.mjs

import { excerpt, wantsExcerpt } from '../../out/mcp/patch.js';
import { quickapps } from '../../out/mcp/tools/quickapps.js';
import { scenes } from '../../out/mcp/tools/scenes.js';
import { strict as assert } from 'node:assert';

const getFile = quickapps.handlers.get_quickapp_file;
const getScene = scenes.handlers.get_scene;

const LINES = Array.from({ length: 500 }, (_, i) => `local line${i + 1} = ${i + 1}`);
const BODY = LINES.join('\n');

const ACTIONS = ['-- irrigation', 'local debugLevel = 2', 'local zones = 4', 'runZones()'].join('\n');
const SCENE_CONTENT = JSON.stringify({ conditions: '{ operator = "all" }', actions: ACTIONS });

function fakeQa() {
  return { async request() { return { name: 'watering', isMain: false, isOpen: false, content: BODY }; } };
}
function fakeScene(type = 'lua') {
  return {
    async request() {
      return { id: 645, name: 'Watering', type, isRunning: false, content: SCENE_CONTENT };
    },
  };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// --- the primitive ---------------------------------------------------------

await check('wantsExcerpt only fires when something was asked for', () => {
  assert.equal(wantsExcerpt(undefined), false);
  assert.equal(wantsExcerpt({}), false);
  assert.equal(wantsExcerpt({ contains: '' }), false);
  assert.equal(wantsExcerpt({ startLine: 5 }), true);
  assert.equal(wantsExcerpt({ contains: 'x' }), true);
});

await check('a line range returns exactly that range, numbered', () => {
  const r = excerpt(BODY, { startLine: 10, endLine: 12 });
  assert.equal(r.totalLines, 500);
  assert.equal(r.returnedLines, 3);
  const lines = r.excerpt.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^\s*10\| local line10 = 10$/);
  assert.match(lines[2], /^\s*12\| local line12 = 12$/);
});

await check('contains returns hits with context and a gap marker', () => {
  const r = excerpt(BODY, { contains: 'line250 ', contextLines: 1 });
  assert.equal(r.matchCount, 1);
  assert.equal(r.returnedLines, 3);
  assert.ok(r.excerpt.includes('249| local line249 = 249'));
  assert.ok(r.excerpt.includes('250| local line250 = 250'));
});

await check('separated hits are divided by an ellipsis', () => {
  const r = excerpt(BODY, { contains: '00 = ', contextLines: 0 });
  assert.ok(r.matchCount > 1);
  assert.ok(r.excerpt.includes('…'), 'expected a gap marker between runs');
});

await check('a range narrows the contains search', () => {
  const all = excerpt(BODY, { contains: 'line1' });
  const narrowed = excerpt(BODY, { contains: 'line1', startLine: 1, endLine: 20 });
  assert.ok(narrowed.matchCount < all.matchCount);
});

await check('no match explains itself rather than returning nothing', () => {
  const r = excerpt(BODY, { contains: 'nowhere' });
  assert.equal(r.matchCount, 0);
  assert.equal(r.excerpt, '');
  assert.match(r.note, /literal and case-sensitive/);
});

await check('the search is case-sensitive and literal', () => {
  assert.equal(excerpt(BODY, { contains: 'LINE250' }).matchCount, 0);
  assert.equal(excerpt('a.b\naxb', { contains: 'a.b' }).matchCount, 1);
});

await check('maxLines truncates and says so', () => {
  const r = excerpt(BODY, { startLine: 1, endLine: 500, maxLines: 10 });
  assert.equal(r.returnedLines, 10);
  assert.equal(r.truncated, true);
  assert.match(r.note, /maxLines/);
});

await check('a range past the end is reported, not thrown', () => {
  const r = excerpt(BODY, { startLine: 9000 });
  assert.equal(r.returnedLines, 0);
  assert.match(r.note, /past the end/);
});

await check('endLine before startLine throws', () => {
  assert.throws(() => excerpt(BODY, { startLine: 10, endLine: 5 }), /before startLine/);
});

await check('an over-long range clamps to the content', () => {
  const r = excerpt(BODY, { startLine: 498, endLine: 9999 });
  assert.equal(r.returnedLines, 3);
});

// --- get_quickapp_file -----------------------------------------------------

await check('get_quickapp_file returns the whole file plus a hash by default', async () => {
  const r = await getFile(fakeQa(), { deviceId: 4933, fileName: 'watering' });
  assert.equal(r.content, BODY);
  assert.match(r.contentHash, /^[0-9a-f]{32}$/);
  assert.ok(!('excerpt' in r));
});

await check('get_quickapp_file with a range returns an excerpt, not the body', async () => {
  const r = await getFile(fakeQa(), {
    deviceId: 4933, fileName: 'watering', startLine: 100, endLine: 102,
  });
  assert.ok(!('content' in r), 'the body must not come back');
  assert.equal(r.contentOmitted, true);
  assert.equal(r.contentLength, BODY.length);
  assert.equal(r.totalLines, 500);
  assert.equal(r.returnedLines, 3);
  assert.match(r.contentHash, /^[0-9a-f]{32}$/);
  assert.ok(r.excerpt.includes('100| local line100 = 100'));
  assert.ok(JSON.stringify(r).length < BODY.length / 4);
});

await check('get_quickapp_file with contains finds the line', async () => {
  const r = await getFile(fakeQa(), { deviceId: 4933, fileName: 'watering', contains: 'line42 ' });
  assert.equal(r.matchCount, 1);
  assert.ok(r.excerpt.includes('42| local line42 = 42'));
});

// --- get_scene -------------------------------------------------------------

await check('get_scene returns content and a hash by default', async () => {
  const r = await getScene(fakeScene(), { sceneId: 645 });
  assert.equal(r.content, SCENE_CONTENT);
  assert.match(r.contentHash, /^[0-9a-f]{32}$/);
});

await check('includeContent=false still returns the hash', async () => {
  const r = await getScene(fakeScene(), { sceneId: 645, includeContent: false });
  assert.equal(r.contentOmitted, true);
  assert.equal(r.contentLength, SCENE_CONTENT.length);
  assert.match(r.contentHash, /^[0-9a-f]{32}$/);
  assert.ok(!('content' in r));
});

await check('block="actions" hands back parsed Lua, no second parse', async () => {
  const r = await getScene(fakeScene(), { sceneId: 645, block: 'actions' });
  assert.equal(r.block, 'actions');
  assert.equal(r.blockContent, ACTIONS, 'must be the Lua itself, not JSON-in-JSON');
  assert.equal(r.blockLength, ACTIONS.length);
  assert.ok(!('content' in r));
});

await check('block="conditions" returns the other half', async () => {
  const r = await getScene(fakeScene(), { sceneId: 645, block: 'conditions' });
  assert.equal(r.blockContent, '{ operator = "all" }');
});

await check('block + contains excerpts inside the block', async () => {
  const r = await getScene(fakeScene(), { sceneId: 645, block: 'actions', contains: 'debugLevel' });
  assert.equal(r.block, 'actions');
  assert.equal(r.matchCount, 1);
  assert.ok(r.excerpt.includes('local debugLevel = 2'));
  assert.ok(!('blockContent' in r), 'an excerpt replaces the block body');
});

await check('block on a scenario scene is refused', async () => {
  await assert.rejects(
    () => getScene(fakeScene('scenario'), { sceneId: 645, block: 'actions' }),
    /is for lua scenes/
  );
});

await check('an invalid block name is refused', async () => {
  await assert.rejects(
    () => getScene(fakeScene(), { sceneId: 645, block: 'act' }),
    /must be "actions" or "conditions"/
  );
});

await check('a raw excerpt still works without block', async () => {
  const r = await getScene(fakeScene(), { sceneId: 645, contains: 'debugLevel' });
  assert.equal(r.contentOmitted, true);
  assert.ok(r.excerpt.includes('debugLevel'));
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll excerpt checks passed');
process.exit(failures ? 1 : 0);
