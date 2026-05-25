#!/usr/bin/env node
// Phase 2 — mutating round-trips on disposable resources.
//
// All resources prefixed TEST_${runId}_ (or TEST-${runId}-) and torn down in
// finally even on test failure. Pre-flight orphan sweep cleans up anything
// left by previous crashed runs.
//
// REQUIRES MCP_TEST_ALLOW_MUTATIONS=1.
//
// Test order intentional — later tests reuse fixtures from earlier ones:
//   1. global var lifecycle (create / set / get / delete)
//   2. custom event lifecycle (create / trigger / read refresh-states / delete)
//   3. room lifecycle (create / modify / delete)
//   4. scene lifecycle (create / update content / run sync / modify / disable)
//      — using the room from step 3
//   5. QA lifecycle (create / add file / update file / multi-file update / list /
//                    delete file / restart / delete device)
//   6. QA variable lifecycle (create / set / get / delete + negative cases) — using QA from step 5

import { MCPClient } from './mcp-client.mjs';
import { SANDBOX, SANDBOX_HYPHEN, RUN_ID, unwrap, isErr, errMsg, sweepOrphans, deleteSceneDirect } from './sandbox.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, '../../out/mcp/hc3-mcp-server.js');

if (process.env.MCP_TEST_ALLOW_MUTATIONS !== '1') {
    console.error('Phase 2 is mutating; refusing to run without MCP_TEST_ALLOW_MUTATIONS=1');
    process.exit(2);
}

console.log(`Phase 2 — runId=${RUN_ID}  prefix=${SANDBOX} / ${SANDBOX_HYPHEN}\n`);

const client = new MCPClient({ serverPath: SERVER });
const cleanup = [];
let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else    { fail++; failures.push({ name, detail }); console.log(`  ✗ ${name}  ${detail}`); }
}
async function call(tool, args = {}) {
    return await client.rpc('tools/call', { name: tool, arguments: args }, 30000);
}

try {
    await client.initialize();

    // ---- Pre-flight orphan sweep ------------------------------------
    const swept = await sweepOrphans(call, m => console.log(`  sweep: ${m}`));
    console.log(`Pre-flight: ${swept} orphan resources cleaned\n`);

    // ============================================================
    // [1] Global variable lifecycle
    // ============================================================
    console.log('[1] Global variable lifecycle');
    {
        const name = `${SANDBOX}_counter`;

        const rC = await call('create_global_variable', { varName: name, value: '0' });
        check('create_global_variable', !isErr(rC), errMsg(rC).slice(0,160));
        if (!isErr(rC)) cleanup.push(() => call('delete_global_variable', { varName: name }));

        const rS = await call('set_global_variable', { varName: name, value: '42' });
        check('set_global_variable', !isErr(rS), errMsg(rS).slice(0,160));

        const rG = await call('get_global_variables', {});
        const list = unwrap(rG);
        const found = Array.isArray(list) ? list.find(v => v.name === name) : null;
        check('readback shows updated value', found?.value === '42',
            found ? `value=${JSON.stringify(found.value)}` : 'not found in list');

        const rD = await call('delete_global_variable', { varName: name });
        check('delete_global_variable', !isErr(rD), errMsg(rD).slice(0,160));
        // Drop the cleanup we just used
        cleanup.pop();

        // Verify gone
        const rG2 = await call('get_global_variables', {});
        const list2 = unwrap(rG2);
        const stillThere = Array.isArray(list2) && list2.some(v => v.name === name);
        check('variable absent after delete', !stillThere);
    }

    // ============================================================
    // [2] Custom event lifecycle
    // ============================================================
    console.log('\n[2] Custom event lifecycle');
    {
        const name = `${SANDBOX}_event`;

        const rC = await call('create_custom_event', { name, userDescription: `phase2 sandbox event ${RUN_ID}` });
        check('create_custom_event', !isErr(rC), errMsg(rC).slice(0,160));
        if (!isErr(rC)) cleanup.push(() => call('delete_custom_event', { name }));

        const rT = await call('trigger_custom_event', { name });
        check('trigger_custom_event', !isErr(rT), errMsg(rT).slice(0,160));

        const rL = await call('get_custom_events', {});
        const list = unwrap(rL);
        const found = Array.isArray(list) ? list.find(e => e.name === name) : null;
        check('event present in list', !!found);

        const rD = await call('delete_custom_event', { name });
        check('delete_custom_event', !isErr(rD), errMsg(rD).slice(0,160));
        cleanup.pop();
    }

    // ============================================================
    // [3] Room lifecycle
    // Skipped if HC3 is in STARTING_SERVICES — POST /api/rooms returns
    // "Invalid request" 400 in that state regardless of payload (verified
    // via direct curl). Test will run normally on a healthy controller.
    // ============================================================
    console.log('\n[3] Room lifecycle');
    let testRoomId = null;
    const rsCheck = await call('get_refresh_states', {});
    const rsStatus = unwrap(rsCheck)?.status || '';
    if (rsStatus === 'STARTING_SERVICES') {
        console.log(`  - skipped (controller status=${rsStatus}; rooms-creation panel unavailable)`);
    } else {
        const rC = await call('create_room', { name: `${SANDBOX_HYPHEN}_room`, sectionID: 219, category: 'other' });
        const created = unwrap(rC);
        testRoomId = created?.id || created?.room?.id;
        check('create_room', !isErr(rC) && !!testRoomId, errMsg(rC).slice(0,160));
        if (testRoomId) cleanup.push(() => call('delete_room', { roomId: testRoomId }));

        if (testRoomId) {
            const rM = await call('modify_room', { roomId: testRoomId, name: `${SANDBOX_HYPHEN}_room_renamed` });
            check('modify_room (rename)', !isErr(rM), errMsg(rM).slice(0,160));

            const rG = await call('get_room', { roomId: testRoomId });
            const got = unwrap(rG);
            check('readback shows new name', got?.name === `${SANDBOX_HYPHEN}_room_renamed`,
                `name=${JSON.stringify(got?.name)}`);
        }
    }

    // ============================================================
    // [4] Scene lifecycle (uses room from [3])
    // ============================================================
    console.log('\n[4] Scene lifecycle');
    let testSceneId = null;
    {
        const baseRoom = testRoomId || 367;
        const rC = await call('create_scene', {
            name: `${SANDBOX_HYPHEN}_scene`,
            type: 'lua',
            roomId: baseRoom,
            content: { conditions: '{}', actions: `fibaro.debug("PHASE2_${RUN_ID}", "v1")` },
        });
        const created = unwrap(rC);
        testSceneId = created?.sceneId || created?.scene?.id;
        check('create_scene', !!testSceneId, !testSceneId ? JSON.stringify(unwrap(rC)).slice(0,200) : '');
        if (testSceneId) cleanup.push(() => deleteSceneDirect(testSceneId));   // direct REST DELETE — MCP has no delete_scene

        if (testSceneId) {
            const rU = await call('update_scene_content', {
                sceneId: testSceneId,
                actions: `fibaro.debug("PHASE2_${RUN_ID}", "v2-after-update")`,
            });
            check('update_scene_content', !isErr(rU), errMsg(rU).slice(0,160));

            const rR = await call('run_scene_sync', { sceneId: testSceneId });
            check('run_scene_sync executes', !isErr(rR), errMsg(rR).slice(0,160));

            const rM = await call('modify_scene', { sceneId: testSceneId, properties: { name: `${SANDBOX_HYPHEN}_scene_renamed`, enabled: true } });
            check('modify_scene (rename)', !isErr(rM), errMsg(rM).slice(0,160));
        }
    }

    // ============================================================
    // [5] QA lifecycle + UTF-8 file round-trip
    // ============================================================
    console.log('\n[5] QA + file lifecycle');
    let testQaId = null;
    {
        const rC = await call('create_quickapp', {
            name: `${SANDBOX_HYPHEN}_qa`,
            type: 'com.fibaro.binarySwitch',
            roomId: 367,
        });
        const created = unwrap(rC);
        testQaId = created?.id || created?.deviceId;
        check('create_quickapp', !isErr(rC) && !!testQaId, errMsg(rC).slice(0,160));
        if (testQaId) cleanup.push(() => call('delete_device', { deviceId: testQaId }));

        if (testQaId) {
            const rAdd = await call('create_quickapp_file', {
                deviceId: testQaId, fileName: 'helper',
                content: '-- helper file for phase 2 round-trip\nlocal M = {}\nfunction M.hello() return "hi" end\nreturn M\n',
            });
            check('create_quickapp_file', !isErr(rAdd), errMsg(rAdd).slice(0,160));

            const utf8src = '-- ° Δ — ü ★ 🌧️\nfunction QuickApp:onInit() self:debug("UTF8 OK") end\n';
            const rUpd = await call('update_quickapp_file', { deviceId: testQaId, fileName: 'main', content: utf8src });
            check('update_quickapp_file (UTF-8 source)', !isErr(rUpd), errMsg(rUpd).slice(0,160));

            const rGet = await call('get_quickapp_file', { deviceId: testQaId, fileName: 'main' });
            const got = unwrap(rGet)?.content;
            check('UTF-8 byte-for-byte round-trip', got === utf8src,
                got === utf8src ? '' : `mismatch: lengths got=${got?.length} want=${utf8src.length}`);

            const rMulti = await call('update_multiple_quickapp_files', {
                deviceId: testQaId,
                files: [
                    { fileName: 'main', content: utf8src + '-- updated again\n', isOpen: true },
                    { fileName: 'helper', content: '-- helper v2\nreturn {}\n', isOpen: false },
                ],
            });
            check('update_multiple_quickapp_files', !isErr(rMulti), errMsg(rMulti).slice(0,160));

            const rList = await call('list_quickapp_files', { deviceId: testQaId });
            const fileList = unwrap(rList);
            const hasBoth = Array.isArray(fileList)
                && fileList.some(f => f.name === 'main')
                && fileList.some(f => f.name === 'helper');
            check('list_quickapp_files shows both files', hasBoth,
                hasBoth ? '' : JSON.stringify(fileList).slice(0,160));

            const rDelF = await call('delete_quickapp_file', { deviceId: testQaId, fileName: 'helper' });
            check('delete_quickapp_file', !isErr(rDelF), errMsg(rDelF).slice(0,160));

            const rRestart = await call('restart_quickapp', { deviceId: testQaId });
            check('restart_quickapp', !isErr(rRestart), errMsg(rRestart).slice(0,160));
        }
    }

    // ============================================================
    // [6] QA variable lifecycle (uses QA from [5])
    //
    // Full create → set → get → delete cycle on the ephemeral QA from [5],
    // plus three negative cases (set-on-missing, create-on-existing,
    // delete-on-missing). create_quickapp_variable and
    // delete_quickapp_variable shipped in 4.4.0, closing the previously
    // documented "no API path to create a QA variable" gap.
    // ============================================================
    console.log('\n[6] QA variable lifecycle');
    if (!testQaId) {
        console.log('  - skipped (no testQaId from [5])');
    } else {
        // Negative: set on missing variable should error.
        const rSetMissing = await call('set_quickapp_variable', {
            deviceId: testQaId, name: 'doesNotExist', value: 'x',
        });
        check('set_quickapp_variable rejects unknown name',
            isErr(rSetMissing) && /create_quickapp_variable/.test(errMsg(rSetMissing)),
            isErr(rSetMissing) ? '' : 'expected an error mentioning create_quickapp_variable');

        // Negative: delete on missing variable should error.
        const rDelMissing = await call('delete_quickapp_variable', {
            deviceId: testQaId, name: 'doesNotExist',
        });
        check('delete_quickapp_variable rejects unknown name',
            isErr(rDelMissing), errMsg(rDelMissing).slice(0,160));

        // Create one of each inferred + explicit type.
        const created = [
            { name: 'phase2_str',  value: 'hello',  expectType: 'string' },
            { name: 'phase2_num',  value: 3.14,     expectType: 'number' },
            { name: 'phase2_int',  value: 42,       varType: 'integer', expectType: 'integer' },
            { name: 'phase2_bool', value: true,     expectType: 'bool' },
        ];
        for (const v of created) {
            const args = { deviceId: testQaId, name: v.name, value: v.value };
            if (v.varType) args.varType = v.varType;
            const r = await call('create_quickapp_variable', args);
            const u = unwrap(r);
            check(`create_quickapp_variable ${v.name} (${v.expectType})`,
                !isErr(r) && u?.created?.type === v.expectType,
                isErr(r) ? errMsg(r).slice(0,160) : `got type ${u?.created?.type}`);
        }

        // Negative: create on already-existing variable should error.
        const rCreateDup = await call('create_quickapp_variable', {
            deviceId: testQaId, name: 'phase2_str', value: 'again',
        });
        check('create_quickapp_variable rejects existing name',
            isErr(rCreateDup) && /set_quickapp_variable/.test(errMsg(rCreateDup)),
            isErr(rCreateDup) ? '' : 'expected an error mentioning set_quickapp_variable');

        // Set updates value + preserves type.
        const rSet = await call('set_quickapp_variable', {
            deviceId: testQaId, name: 'phase2_str', value: 'updated',
        });
        const setRes = unwrap(rSet);
        check('set_quickapp_variable updates existing',
            !isErr(rSet) && setRes?.current?.value === 'updated' && setRes?.current?.type === 'string',
            isErr(rSet) ? errMsg(rSet).slice(0,160) : JSON.stringify(setRes?.current));

        // Readback via get.
        const rGet = await call('get_quickapp_variable', { deviceId: testQaId, name: 'phase2_int' });
        const getRes = unwrap(rGet);
        check('get_quickapp_variable readback',
            !isErr(rGet) && Number(getRes?.value) === 42 && getRes?.type === 'integer',
            isErr(rGet) ? errMsg(rGet).slice(0,160) : JSON.stringify(getRes));

        // Delete all four; verify each gone.
        for (const v of created) {
            const r = await call('delete_quickapp_variable', { deviceId: testQaId, name: v.name });
            check(`delete_quickapp_variable ${v.name}`,
                !isErr(r), errMsg(r).slice(0,160));
        }

        // Confirm none remain via get_device_info.
        const rDev = await call('get_device_info', { deviceId: testQaId });
        const remaining = (unwrap(rDev)?.properties?.quickAppVariables ?? [])
            .filter(v => v.name.startsWith('phase2_'));
        check('all phase2_* variables removed after deletes',
            remaining.length === 0,
            remaining.length === 0 ? '' : `still present: ${remaining.map(v => v.name).join(', ')}`);
    }

} catch (e) {
    failures.push({ name: 'fatal', detail: e.message });
} finally {
    console.log(`\n[cleanup] running ${cleanup.length} cleanup actions…`);
    for (const fn of cleanup.reverse()) {
        try { await fn(); }
        catch (e) { console.log(`  warn: cleanup error: ${e.message}`); }
    }
    client.close();
}

console.log(`\n=== Phase 2 summary ===`);
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (failures.length) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f.name}  ${f.detail}`);
    process.exit(1);
}
console.log(`\nPhase 2: PASS`);
