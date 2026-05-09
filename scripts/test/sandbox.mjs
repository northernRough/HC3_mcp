// Test sandbox helpers: per-run TEST_ prefix + cleanup tracker + orphan sweep.

export const RUN_ID = Date.now().toString(36);
export const SANDBOX = `TEST_${RUN_ID}`;          // var-style names: [A-Za-z][A-Za-z0-9_]*
export const SANDBOX_HYPHEN = `TEST-${RUN_ID}`;   // QA / scene names: hyphen ok
export const ORPHAN_PREFIX_VAR = 'TEST_';
export const ORPHAN_PREFIX_HY = 'TEST-';

// HC3 direct DELETE for scenes. The MCP now exposes delete_scene
// [4.3.0], but this direct path is retained for the orphan sweep,
// which runs before the MCP server is up — it's the pre-flight
// cleanup of leftovers from previous crashed runs. Test code running
// after the harness has spawned the server can call delete_scene via
// the MCP instead. Reads the same env vars the MCP server uses.
export async function deleteSceneDirect(sceneId) {
    const host = process.env.FIBARO_HOST;
    const user = process.env.FIBARO_USERNAME;
    const pass = process.env.FIBARO_PASSWORD;
    const port = process.env.FIBARO_PORT || '80';
    if (!host || !user || !pass) throw new Error('FIBARO_HOST/USERNAME/PASSWORD not set');
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await fetch(`http://${host}:${port}/api/scenes/${sceneId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Basic ${auth}` },
    });
    if (!res.ok && res.status !== 404) {
        throw new Error(`DELETE scene ${sceneId} returned HTTP ${res.status}`);
    }
}

export function unwrap(res) {
    const txt = res.result?.content?.[0]?.text;
    if (typeof txt !== 'string') return res.result;
    try { return JSON.parse(txt); } catch { return txt; }
}

export function isErr(res) { return !!res.error || !!res.result?.isError; }

export function errMsg(res) {
    return res.error?.message || res.result?.content?.[0]?.text || '';
}

// Sweep any orphans from previous crashed runs that match TEST_* / TEST-* prefixes.
// Best-effort — log warnings, never throw.
export async function sweepOrphans(call, log = () => {}) {
    let removed = 0;

    // Globals
    try {
        const r = await call('get_global_variables', {});
        const list = unwrap(r);
        if (Array.isArray(list)) {
            for (const v of list) {
                if (typeof v.name === 'string' && v.name.startsWith(ORPHAN_PREFIX_VAR)) {
                    try { await call('delete_global_variable', { varName: v.name }); removed++; }
                    catch (e) { log(`orphan-sweep: delete global ${v.name} failed: ${e.message}`); }
                }
            }
        }
    } catch (e) { log(`orphan-sweep globals: ${e.message}`); }

    // Devices (QAs created via create_quickapp)
    try {
        const r = await call('find_devices_by_name', { name: ORPHAN_PREFIX_HY });
        const list = unwrap(r);
        if (Array.isArray(list)) {
            for (const d of list) {
                if (typeof d.name === 'string' && d.name.startsWith(ORPHAN_PREFIX_HY)) {
                    try { await call('delete_device', { deviceId: d.id }); removed++; }
                    catch (e) { log(`orphan-sweep: delete device ${d.id} failed: ${e.message}`); }
                }
            }
        }
    } catch (e) { log(`orphan-sweep devices: ${e.message}`); }

    // Custom events
    try {
        const r = await call('get_custom_events', {});
        const list = unwrap(r);
        if (Array.isArray(list)) {
            for (const e of list) {
                if (typeof e.name === 'string' && e.name.startsWith(ORPHAN_PREFIX_VAR)) {
                    try { await call('delete_custom_event', { name: e.name }); removed++; }
                    catch (err) { log(`orphan-sweep: delete event ${e.name} failed: ${err.message}`); }
                }
            }
        }
    } catch (e) { log(`orphan-sweep custom events: ${e.message}`); }

    // Scenes (direct REST DELETE — runs pre-MCP, see deleteSceneDirect note)
    try {
        const r = await call('get_scenes', {});
        const list = unwrap(r);
        if (Array.isArray(list)) {
            for (const s of list) {
                if (typeof s.name === 'string' && s.name.startsWith(ORPHAN_PREFIX_HY)) {
                    try { await deleteSceneDirect(s.id); removed++; }
                    catch (err) { log(`orphan-sweep: delete scene ${s.id} failed: ${err.message}`); }
                }
            }
        }
    } catch (e) { log(`orphan-sweep scenes: ${e.message}`); }

    return removed;
}
