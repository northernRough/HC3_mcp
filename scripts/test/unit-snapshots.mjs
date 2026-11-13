#!/usr/bin/env node
// Unit test — 4.34.0: untyped variables stay strings (3.7), set_quickapp_variables
// (3.6), the MCP write log (3.3), and the snapshot read/diff/restore tools (3.5).
// No live HC3: a fake client records every request; the snapshot repo is a
// throwaway git repo built here (no git-crypt: its secrets/ files are plain).
//
//   node scripts/test/unit-snapshots.mjs

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const { coerceVarValue, setQuickAppVariables } = await import('../../out/mcp/tools/quickapps.js');
const { writeEntry, recordWrite, resetWriteLogPathCache } = await import('../../out/mcp/writelog.js');

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex');

// ---------------------------------------------------------------- 3.7
console.log('coerceVarValue');
await check('untyped true is written as the string "true"', () => assert.equal(coerceVarValue(undefined, true, 'x'), 'true'));
await check('untyped 15 is written as the string "15"', () => assert.equal(coerceVarValue(undefined, 15, 'x'), '15'));
await check('empty-string type counts as untyped', () => assert.equal(coerceVarValue('', false, 'x'), 'false'));
await check('string type stringifies numbers', () => assert.equal(coerceVarValue('string', 3, 'x'), '3'));
await check('number type stays numeric', () => assert.equal(coerceVarValue('number', '2.5', 'x'), 2.5));
await check('integer truncates', () => assert.equal(coerceVarValue('integer', 7.9, 'x'), 7));
await check('bool accepts "true"', () => assert.equal(coerceVarValue('bool', 'true', 'x'), true));
await check('bool rejects nonsense', () => assert.throws(() => coerceVarValue('bool', 'maybe', 'x')));

// ---------------------------------------------------------------- 3.6
function fakeHc3(vars, files = {}, view = {}) {
  const calls = [];
  const state = { vars: vars.map(v => ({ ...v })), files: { ...files }, view: { ...view } };
  return {
    calls, state,
    async request(endpoint, method = 'GET', body) {
      calls.push({ endpoint, method, body });
      let m;
      if ((m = endpoint.match(/^\/api\/devices\/(\d+)$/))) {
        if (method === 'PUT') {
          const { quickAppVariables, ...rest } = body.properties;
          if (quickAppVariables) state.vars = quickAppVariables.map(v => ({ ...v }));
          Object.assign(state.view, JSON.parse(JSON.stringify(rest)));
          return {};
        }
        return { id: Number(m[1]), name: 'Shading', enabled: true, interfaces: ['quickApp'],
                 properties: { quickAppVariables: state.vars.map(v => ({ ...v })), ...JSON.parse(JSON.stringify(state.view)) } };
      }
      if (endpoint.startsWith('/api/plugins/getView')) {
        // Model HC3: a layout containing BAD renders as an empty tile.
        const items = JSON.stringify(state.view).includes('BAD') ? [] : (state.view.viewLayout?.$jason?.body?.sections?.items ?? []);
        return { $jason: { body: { sections: { items } } } };
      }
      if ((m = endpoint.match(/^\/api\/quickApp\/\d+\/files$/))) {
        if (method === 'PUT') { for (const f of body) state.files[f.name] = f.content; return body.map(f => ({ name: f.name })); }
        if (method === 'POST') { state.files[body.name] = body.content; return { name: body.name }; }
        return Object.keys(state.files).map(n => ({ name: n, isMain: n === 'main' }));
      }
      if ((m = endpoint.match(/^\/api\/quickApp\/\d+\/files\/(.+)$/))) {
        const n = decodeURIComponent(m[1]);
        if (!(n in state.files)) throw new Error('404');
        return { name: n, content: state.files[n] };
      }
      throw new Error(`unexpected ${method} ${endpoint}`);
    },
  };
}

console.log('set_quickapp_variables');
await check('five variables, ONE PUT, untyped kept as strings', async () => {
  const hc3 = fakeHc3([
    { name: 'dryRun', value: 'true' }, { name: 'winterMask', value: 'false' }, { name: 'showDetail', value: 'false' },
    { name: 'winterOutdoorC', value: '12' }, { name: 'tickSeconds', type: 'number', value: 300 }, { name: 'keep', value: 'me' },
  ]);
  const r = await setQuickAppVariables(hc3, 4984, { dryRun: false, winterMask: true, showDetail: true, winterOutdoorC: 15, tickSeconds: '120' });
  assert.equal(hc3.calls.filter(c => c.method === 'PUT').length, 1);
  assert.equal(r.writes, 1);
  const by = Object.fromEntries(hc3.state.vars.map(v => [v.name, v.value]));
  assert.deepEqual(by, { dryRun: 'false', winterMask: 'true', showDetail: 'true', winterOutdoorC: '15', tickSeconds: 120, keep: 'me' });
});
await check('an unknown name writes nothing', async () => {
  const hc3 = fakeHc3([{ name: 'a', value: '1' }]);
  await assert.rejects(setQuickAppVariables(hc3, 1, { a: '2', nope: 'x' }), /Nothing written/);
  assert.equal(hc3.calls.filter(c => c.method === 'PUT').length, 0);
});

// ---------------------------------------------------------------- 3.3
console.log('write log');
await check('file write logs deviceId', () => assert.deepEqual(
  writeEntry('patch_quickapp_file', { deviceId: 4984 }, {}, true, 1_000_000),
  { at: 1000, kind: 'QuickApp', deviceId: 4984, tool: 'patch_quickapp_file', ok: true }));
await check('scene write logs sceneId', () => assert.equal(writeEntry('update_scene_content', { sceneId: 82 }, {}, true).sceneId, 82));
await check('create takes the id from the result', () => assert.equal(writeEntry('create_quickapp', {}, { id: 5100 }, true).deviceId, 5100));
await check('reads are not logged', () => assert.equal(writeEntry('get_quickapp_file', { deviceId: 1 }, {}, true), null));
await check('recordWrite appends to MCP_WRITE_LOG', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-'));
  const saved = { ...process.env };
  process.env.MCP_FRICTION_DISABLE = 'false'; process.env.MCP_WRITE_LOG = join(dir, 'w.jsonl');
  resetWriteLogPathCache();
  recordWrite('update_multiple_quickapp_files', { deviceId: 7 }, {}, false);
  const line = JSON.parse(readFileSync(join(dir, 'w.jsonl'), 'utf8').trim());
  Object.assign(process.env, saved); delete process.env.MCP_WRITE_LOG; resetWriteLogPathCache();
  rmSync(dir, { recursive: true });
  assert.equal(line.deviceId, 7); assert.equal(line.ok, false);
});

// ---------------------------------------------------------------- 3.5
console.log('snapshot tools');
const repo = mkdtempSync(join(tmpdir(), 'snap-'));
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
const SECRET = 'hunter2-very-secret';
const SNAP_VIEW = { viewLayout: { $jason: { body: { sections: { items: [{ type: 'label', name: 'l1' }, { type: 'button', name: 'roomSlider' }] } } } },
                    uiCallbacks: [{ name: 'roomSlider', eventType: 'onChanged', callback: 'roomSlider' }], useUiView: false };
let snapView = SNAP_VIEW;
function writeSnap(mainSrc, engineSrc, vars, msg, date) {
  const f = join(repo, 'quickapps', '4984-shading');
  mkdirSync(join(f, 'files'), { recursive: true }); mkdirSync(join(repo, 'secrets'), { recursive: true });
  writeFileSync(join(f, 'files', 'main.lua'), mainSrc);
  writeFileSync(join(f, 'files', 'engine.lua'), engineSrc);
  writeFileSync(join(f, 'metadata.json'), JSON.stringify({ id: 4984, name: 'Shading', properties: { quickAppVariables: vars, ...snapView } }));
  writeFileSync(join(repo, 'secrets', 'quickapp-vars.json'), JSON.stringify({ 4984: { name: 'Shading', vars: { apiKey: SECRET } } }));
  writeFileSync(join(repo, 'secrets', 'inline.json'), JSON.stringify({ 'hc3/password': { value: SECRET, files: [] } }));
  g('add', '-A'); execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg], { env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
}
const NEW_MAIN = 'local PASS = "«secret:hc3/password»"\nfunction QuickApp:onInit() self:winter() end\n';
const NEW_MAIN_REAL = NEW_MAIN.replace('«secret:hc3/password»', SECRET);
const vars = [{ name: 'dryRun', value: 'false' }, { name: 'winterMask', value: 'true' }, { name: 'apiKey', value: '«secret»' }, { name: 'state', value: '{"night":1}' }];
writeSnap('-- old main\n', '-- old engine\n', vars, 'snapshot: 2026-11-12 01:24:00 UTC', '2026-11-12T01:24:00Z');
writeSnap(NEW_MAIN, '-- new engine\n', vars, 'snapshot: 2026-11-13 01:24:00 UTC', '2026-11-13T01:24:00Z');
process.env.HC3_SNAPSHOT_REPO = repo;
const { snapshots } = await import('../../out/mcp/tools/snapshots.js');
const H = snapshots.handlers;

await check('list_snapshots, newest first, filtered by device', async () => {
  const r = await H.list_snapshots(null, { deviceId: 4984 });
  assert.equal(r.count, 2);
  assert.match(r.snapshots[0].message, /11-13/);
  assert.ok(r.snapshots[0].changed.includes('main'));
});
await check('before:<date> picks the older snapshot', async () => {
  const r = await H.get_snapshot_quickapp(null, { deviceId: 4984, commit: 'before:2026-11-12T12:00' });
  assert.equal(r.files.find(f => f.fileName === 'main').contentHash, md5('-- old main\n'));
});
await check('get_snapshot_quickapp hashes the UNREDACTED content but never returns a secret', async () => {
  const r = await H.get_snapshot_quickapp(null, { deviceId: 4984, commit: 'latest', includeContent: true });
  const main = r.files.find(f => f.fileName === 'main');
  assert.equal(main.contentHash, md5(NEW_MAIN_REAL));
  assert.ok(!JSON.stringify(r).includes(SECRET), 'secret leaked');
  assert.equal(r.variables.find(v => v.name === 'apiKey').value, '«secret»');
});
await check('a bad commit ref is refused before reaching git', async () => {
  await assert.rejects(H.get_snapshot_quickapp(null, { deviceId: 4984, commit: '--upload-pack=x' }), /commit must be/);
});

// The 13 Nov situation: live has the OLD code and old variable values.
const liveFiles = () => ({ main: '-- old main\n', engine: '-- old engine\n', extra: '-- live only\n' });
const liveVars = () => [{ name: 'dryRun', value: 'true' }, { name: 'winterMask', value: 'false' }, { name: 'apiKey', value: SECRET }, { name: 'state', value: '{"now":2}' }];

await check('diff reports differing files and variables, secret by status only', async () => {
  const hc3 = fakeHc3(liveVars(), liveFiles());
  const r = await H.diff_quickapp_vs_snapshot(hc3, { deviceId: 4984, commit: 'latest' });
  assert.deepEqual(r.summary.files, { same: 0, differs: 2, onlyInSnapshot: 0, onlyLive: 1 });
  assert.equal(r.variables.find(v => v.name === 'apiKey').status, 'same');
  assert.equal(r.variables.find(v => v.name === 'winterMask').status, 'differs');
  const st = r.variables.find(v => v.name === 'state');
  assert.equal(st.runtime, true);                       // JSON blob = runtime state
  assert.equal(r.variables.find(v => v.name === "winterMask").runtime, undefined);  // plain value = setting
  assert.equal(r.summary.variables.differs, 2);          // dryRun, winterMask; NOT state
  assert.equal(r.summary.variables.runtime, 1);
  assert.ok(!JSON.stringify(r).includes(SECRET), 'secret leaked');
});
await check('preview writes nothing', async () => {
  const hc3 = fakeHc3(liveVars(), liveFiles());
  const r = await H.restore_quickapp_from_snapshot(hc3, { deviceId: 4984, commit: 'latest', variables: 'differing', dryRunFirst: true, preview: true });
  assert.equal(r.written, false);
  assert.equal(hc3.calls.filter(c => c.method !== 'GET').length, 0);
});
await check('restore: one variable write first (dryRun stays "true"), then one file push, verified', async () => {
  const hc3 = fakeHc3(liveVars(), liveFiles());
  const r = await H.restore_quickapp_from_snapshot(hc3, { deviceId: 4984, commit: 'latest', variables: 'differing', dryRunFirst: true });
  const writes = hc3.calls.filter(c => c.method !== 'GET');
  assert.equal(writes.length, 2);
  assert.match(writes[0].endpoint, /\/api\/devices\/4984$/);          // variables first
  assert.match(writes[1].endpoint, /\/api\/quickApp\/4984\/files$/);  // then one push
  assert.equal(hc3.state.files.main, NEW_MAIN_REAL);                  // secret re-inserted server side
  assert.equal(hc3.state.files.extra, '-- live only\n');              // never deleted
  const by = Object.fromEntries(hc3.state.vars.map(v => [v.name, v.value]));
  assert.equal(by.dryRun, 'true');                                    // dryRunFirst wins over the snapshot's "false"
  assert.equal(by.winterMask, 'true');
  assert.equal(by.state, '{"now":2}');                                // runtime: skipped by 'differing'
  assert.deepEqual(r.untouched.runtimeVariablesSkipped, ['state']);
  assert.equal(r.verified, true);
  assert.ok(!JSON.stringify(r).includes(SECRET), 'secret leaked');
});
const OLD_VIEW = { viewLayout: { $jason: { body: { sections: { items: [{ type: 'label', name: 'l1' }] } } } }, uiCallbacks: [], useUiView: false };
await check('diff reports the tile differing, key order ignored', async () => {
  const reordered = { useUiView: false, uiCallbacks: [{ callback: 'roomSlider', eventType: 'onChanged', name: 'roomSlider' }], viewLayout: SNAP_VIEW.viewLayout };
  let r = await H.diff_quickapp_vs_snapshot(fakeHc3(liveVars(), liveFiles(), reordered), { deviceId: 4984, commit: 'latest' });
  assert.equal(r.summary.view.differs, 0);
  r = await H.diff_quickapp_vs_snapshot(fakeHc3(liveVars(), liveFiles(), OLD_VIEW), { deviceId: 4984, commit: 'latest' });
  assert.deepEqual(r.view.filter(v => v.status === 'differs').map(v => v.property).sort(), ['uiCallbacks', 'viewLayout']);
});
await check('without includeView the tile is untouched but flagged', async () => {
  const hc3 = fakeHc3(liveVars(), liveFiles(), OLD_VIEW);
  const r = await H.restore_quickapp_from_snapshot(hc3, { deviceId: 4984, commit: 'latest', preview: true });
  assert.deepEqual(r.viewDiffers.sort(), ['uiCallbacks', 'viewLayout']);
});
await check('includeView writes the differing tile properties LAST, verified', async () => {
  const hc3 = fakeHc3(liveVars(), liveFiles(), OLD_VIEW);
  const r = await H.restore_quickapp_from_snapshot(hc3, { deviceId: 4984, commit: 'latest', includeView: true });
  const writes = hc3.calls.filter(c => c.method !== 'GET');
  assert.match(writes.at(-1).endpoint, /\/api\/devices\/4984$/);
  assert.deepEqual(Object.keys(writes.at(-1).body.properties).sort(), ['uiCallbacks', 'viewLayout']);
  assert.equal(r.view.itemsBefore, 1); assert.equal(r.view.itemsAfter, 2); assert.equal(r.view.verified, true);
});
await check('a tile that renders empty is rolled back', async () => {
  snapView = { ...SNAP_VIEW, viewLayout: { $jason: { body: { sections: { items: [{ type: 'label', name: 'BAD' }] } } } } };
  writeSnap(NEW_MAIN, '-- new engine\n', vars, 'snapshot: 2026-11-13 02:00:00 UTC', '2026-11-13T02:00:00Z');
  const hc3 = fakeHc3(liveVars(), liveFiles(), OLD_VIEW);
  await assert.rejects(H.restore_quickapp_from_snapshot(hc3, { deviceId: 4984, commit: 'latest', files: 'none', includeView: true }), /ROLLED BACK/);
  assert.equal(JSON.stringify(hc3.state.view.viewLayout), JSON.stringify(OLD_VIEW.viewLayout));
  snapView = SNAP_VIEW;
});
await check('a runtime variable named explicitly IS restored', async () => {
  const hc3 = fakeHc3(liveVars(), liveFiles());
  await H.restore_quickapp_from_snapshot(hc3, { deviceId: 4984, commit: 'latest', files: 'none', variables: ['state'] });
  assert.equal(hc3.state.vars.find(v => v.name === 'state').value, '{"night":1}');
});
await check('dryRunFirst on a QA without dryRun is refused, nothing written', async () => {
  const hc3 = fakeHc3([{ name: 'other', value: '1' }], liveFiles());
  // the snapshot HAS dryRun, so remove it from consideration by restoring from a QA without one
  writeSnap('-- x\n', '-- y\n', [{ name: 'other', value: '1' }], 'snapshot: 2026-11-14 01:24:00 UTC', '2026-11-14T01:24:00Z');
  await assert.rejects(H.restore_quickapp_from_snapshot(hc3, { deviceId: 4984, commit: 'latest', dryRunFirst: true }), /no dryRun variable/);
  assert.equal(hc3.calls.filter(c => c.method !== 'GET').length, 0);
});

rmSync(repo, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
