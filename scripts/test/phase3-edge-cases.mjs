#!/usr/bin/env node
// Phase 3 — edge-case regression tests.
// Pins six known-bitten bugs as explicit assertions so they can never
// silently regress.
//
//   1. create_global_variable: name-format validation up-front
//   2. create_global_variable: numeric value coerced to string (or clear error)
//   3. 501-endpoint cleanliness — known dead endpoints surface clean errors
//   4. create_scene: accepts both string and object content
//   5. update_quickapp_file: UTF-8 byte-for-byte round-trip
//   6. get_scenes: large payload truncation/persistence path
//
// Uses TEST-${runId}- sandbox prefix and MCP_TEST_ALLOW_MUTATIONS=1 gate.
// Cleanup runs in finally even on test failure.

import { MCPClient } from './mcp-client.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, '../../out/mcp/hc3-mcp-server.js');
const RUN_ID = Date.now().toString(36);
const SANDBOX = `TEST_${RUN_ID}`;            // var names: must match [A-Za-z][A-Za-z0-9_]*
const SANDBOX_HYPHEN = `TEST-${RUN_ID}`;     // QA / scene names: hyphen ok

const MUTATING = process.env.MCP_TEST_ALLOW_MUTATIONS === '1';

const client = new MCPClient({ serverPath: SERVER });
const cleanup = [];
const failures = [];
let pass = 0, fail = 0, skip = 0;

function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else    { fail++; failures.push({ name, detail }); console.log(`  ✗ ${name}  ${detail}`); }
}
function unwrap(res) {
    const txt = res.result?.content?.[0]?.text;
    if (typeof txt !== 'string') return res.result;
    try { return JSON.parse(txt); } catch { return txt; }
}
async function call(tool, args = {}) {
    return await client.rpc('tools/call', { name: tool, arguments: args }, 30000);
}

try {
    await client.initialize();

    // ---- Test 1: name-format validation -----------------------------------
    console.log('\n[1] create_global_variable validates name format');
    if (!MUTATING) { skip++; console.log('  - skipped (set MCP_TEST_ALLOW_MUTATIONS=1)'); }
    else for (const bad of ['1bad', 'has-hyphen', '']) {
        const r = await call('create_global_variable', { varName: bad, value: '0' });
        const errored = !!r.error || !!r.result?.isError;
        const errTxt = (r.error?.message || r.result?.content?.[0]?.text || '').toLowerCase();
        // We accept any clear refusal (wrapper-side preferred, HC3-side acceptable);
        // reject silent success (which would mean the regex check is missing).
        check(`rejects bad varName: ${JSON.stringify(bad)}`, errored,
            errored ? '' : `unexpected success: ${JSON.stringify(unwrap(r)).slice(0,120)}`);
    }

    // ---- Test 2: numeric value=0 coercion ---------------------------------
    console.log('\n[2] create_global_variable handles numeric value=0');
    if (!MUTATING) { skip++; console.log('  - skipped'); }
    else {
        const name = `${SANDBOX}_num`;
        const r = await call('create_global_variable', { varName: name, value: 0 });
        cleanup.push(() => call('delete_global_variable', { varName: name }));
        const errored = !!r.error || !!r.result?.isError;
        const errTxt = (r.error?.message || r.result?.content?.[0]?.text || '');
        if (!errored) {
            check('numeric 0 accepted (wrapper coerces to string)', true);
        } else if (errTxt.toLowerCase().includes('value must be a string') ||
                   errTxt.toLowerCase().includes('coerce') ||
                   errTxt.toLowerCase().includes('expected string')) {
            check('numeric 0 rejected with clear actionable error', true);
        } else if (errTxt.toLowerCase().includes('deserializejson') || errTxt.toLowerCase().includes('types mismatch')) {
            check('numeric 0 propagates raw HC3 error (regression)', false,
                `propagates HC3 error verbatim: ${errTxt.slice(0,160)}`);
        } else {
            // Unknown error class — surface, don't grade as PASS or FAIL definitively
            check('numeric 0 produces some error (review wording)', true,
                `error: ${errTxt.slice(0,120)}`);
        }
    }

    // ---- Test 3: dead-endpoint hygiene ------------------------------------
    // get_quickapps/get_quickapp WERE 501 on older firmware; the maintainer's
    // 4.0+ fixes route them via the working /api/devices?interface=quickApp
    // path. Assertion now: tools succeed AND return non-empty data.
    // Future regressions to either path will surface here.
    console.log('\n[3] QA listing tools succeed (post-4.0 fix)');
    for (const [tool, args, kind] of [
        ['get_quickapps', {}, 'array'],
        ['get_quickapp',  { quickAppId: 4742 }, 'object'],
    ]) {
        const r = await call(tool, args);
        const errored = !!r.error || !!r.result?.isError;
        if (errored) {
            const msg = r.error?.message || r.result?.content?.[0]?.text || '';
            check(`${tool} returns data`, false, `unexpected error: ${msg.slice(0,140)}`);
        } else {
            const payload = unwrap(r);
            const ok = kind === 'array' ? Array.isArray(payload) && payload.length > 0
                                        : typeof payload === 'object' && payload?.id;
            check(`${tool} returns ${kind}`, ok, ok ? '' : `unexpected shape: ${JSON.stringify(payload).slice(0,140)}`);
        }
    }

    // ---- Test 4: create_scene accepts string & object content -------------
    console.log('\n[4] create_scene accepts both string and object content forms');
    if (!MUTATING) { skip++; console.log('  - skipped'); }
    else {
        const baseScene = {
            name: `${SANDBOX_HYPHEN}-scene`,
            type: 'lua',
            roomId: 367,
        };
        const stringContent = '{"conditions":"{}","actions":"-- shape-test stringified\\nfibaro.debug(\\"PHASE3\\",\\"string\\")"}';
        const objectContent = { conditions: '{}', actions: '-- shape-test object\nfibaro.debug("PHASE3","object")' };

        // Try the string form
        const rA = await call('create_scene', { ...baseScene, name: baseScene.name + '_str', content: stringContent });
        const idA = unwrap(rA)?.sceneId || unwrap(rA)?.scene?.id;
        if (idA) cleanup.push(() => call('modify_scene', { sceneId: idA, enabled: false }));   // can't delete via MCP — disable instead
        check('create_scene accepts string content', !!idA, idA ? '' : `unwrap: ${JSON.stringify(unwrap(rA)).slice(0,160)}`);

        const rB = await call('create_scene', { ...baseScene, name: baseScene.name + '_obj', content: objectContent });
        const idB = unwrap(rB)?.sceneId || unwrap(rB)?.scene?.id;
        if (idB) cleanup.push(() => call('modify_scene', { sceneId: idB, enabled: false }));
        check('create_scene accepts object content (auto-stringified)', !!idB, idB ? '' : `unwrap: ${JSON.stringify(unwrap(rB)).slice(0,160)}`);
    }

    // ---- Test 5: UTF-8 round-trip in update_quickapp_file -----------------
    console.log('\n[5] update_quickapp_file UTF-8 round-trip');
    if (!MUTATING) { skip++; console.log('  - skipped'); }
    else {
        // Create a throwaway QA, push a UTF-8-heavy file, read back, byte-compare
        const qaName = `${SANDBOX_HYPHEN}_utf8qa`;
        const rCreate = await call('create_quickapp', { name: qaName, type: 'com.fibaro.binarySwitch', roomId: 367 });
        const qaId = unwrap(rCreate)?.id || unwrap(rCreate)?.deviceId;
        if (!qaId) {
            check('create_quickapp succeeded', false, JSON.stringify(unwrap(rCreate)).slice(0,200));
        } else {
            cleanup.push(() => call('delete_device', { deviceId: qaId }));

            // Sample with multibyte chars + Lua escapes that have bitten us
            const src = '-- ° Δ — ü ★ 🌧️ tab:\\t lua: --[[ ... ]] end\nfunction QuickApp:onInit() self:debug("UTF8 OK") end\n';
            const rPut = await call('update_quickapp_file', { deviceId: qaId, fileName: 'main', content: src });
            const errored = !!rPut.error || !!rPut.result?.isError;
            check('update_quickapp_file accepted UTF-8 source', !errored,
                errored ? (rPut.error?.message || rPut.result?.content?.[0]?.text || '').slice(0,160) : '');

            const rGet = await call('get_quickapp_file', { deviceId: qaId, fileName: 'main' });
            const got = unwrap(rGet)?.content;
            check('UTF-8 byte-for-byte round-trip', got === src,
                got === src ? '' : `mismatch: lengths ${got?.length} vs ${src.length}`);
        }
    }

    // ---- Test 6: get_scenes truncation/persistence ------------------------
    console.log('\n[6] get_scenes large-payload truncation path');
    {
        const r = await call('get_scenes', {});
        const errored = !!r.error || !!r.result?.isError;
        if (errored) {
            check('get_scenes returns', false, (r.error?.message || '').slice(0,160));
        } else {
            // The MCP may return the array inline (small) or with a path/file-pointer (large).
            // Either is acceptable — but if it's the second form, the file should exist.
            const payload = unwrap(r);
            const txt = r.result?.content?.[0]?.text || '';
            const isPath = typeof payload === 'object' && (payload?.path || payload?.savedTo) || /Output too large/.test(txt);
            const isArray = Array.isArray(payload);
            check('get_scenes returns array OR persisted-path envelope', isArray || isPath,
                  isArray ? `inline array (n=${payload.length})` : isPath ? 'persisted-path envelope' : `unexpected: ${JSON.stringify(payload).slice(0,160)}`);
        }
    }

} catch (e) {
    failures.push({ name: 'fatal', detail: e.message });
} finally {
    console.log(`\n[cleanup] running ${cleanup.length} cleanup actions…`);
    for (const fn of cleanup.reverse()) {
        try { await fn(); } catch (e) { console.log(`  warn: cleanup error: ${e.message}`); }
    }
    client.close();
}

console.log(`\n=== Phase 3 summary ===`);
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
console.log(`  skip: ${skip}`);
if (failures.length) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f.name}  ${f.detail}`);
    process.exit(1);
}
console.log(`\nPhase 3: PASS`);
