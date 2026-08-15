#!/usr/bin/env node
// Phase 0 — registration parity + schema validity check.
//
// Spawns the modularised server, lists tools, and:
//   1. validates each tool has name/description/inputSchema with required shape;
//   2. compares against tools.golden.json;
//   3. writes the current tool list to tools.golden.json on first run (use --update to overwrite).
//
// Modes:
//   (none)     compare and fail on removed tools or drift; a NEW tool is
//              reported but tolerated, since the snapshot legitimately lags a
//              tool that was just added.
//   --check    total equality: the committed snapshot must equal what the
//              server produces, added tools included. Never writes. This is
//              the gate npm test and CI run.
//   --update   overwrite the snapshot from the live server.
//
// Descriptions are compared, not just inputSchema. They were not, once, and
// four releases shipped a stale snapshot through a green Phase 0: every drift
// was description-only, so the schema comparison saw nothing and CI caught it
// only by regenerating and diffing with git. A tool's description is its
// interface to the model — drift there is drift.
//
// Exit code: 0 on success, 1 on schema/parity failure.
//
// Env: FIBARO_HOST, FIBARO_USERNAME, FIBARO_PASSWORD, FIBARO_PORT (or rely on the
// MCP server's own .env file). The server is expected to be at out/mcp/hc3-mcp-server.js.

import { MCPClient } from './mcp-client.mjs';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SERVER = resolve(PROJECT_ROOT, 'out/mcp/hc3-mcp-server.js');
const GOLDEN = resolve(__dirname, 'tools.golden.json');

const update = process.argv.includes('--update');
const check  = process.argv.includes('--check');
const failures = [];

if (update && check) {
    console.log('--update and --check are contradictory: one rewrites the snapshot, the other asserts it is already correct.');
    process.exit(1);
}

// The snapshot is these three fields, sorted by name. Kept in one place so the
// comparison below and the file written by --update can never disagree.
const snapshotOf = tools => tools
    .map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));

const client = new MCPClient({ serverPath: SERVER });
try {
    const initRes = await client.initialize();
    if (initRes.error) { failures.push(`initialize: ${JSON.stringify(initRes.error)}`); throw new Error('init failed'); }

    const listRes = await client.rpc('tools/list');
    if (listRes.error) { failures.push(`tools/list: ${JSON.stringify(listRes.error)}`); throw new Error('list failed'); }

    const tools = listRes.result.tools;
    console.log(`Tools registered: ${tools.length}`);

    // --- Schema validity check ---------------------------------------
    let schemaIssues = 0;
    for (const t of tools) {
        if (!t.name || typeof t.name !== 'string') { failures.push(`tool missing name: ${JSON.stringify(t).slice(0,80)}`); schemaIssues++; continue; }
        if (!t.description || typeof t.description !== 'string') { failures.push(`${t.name}: missing description`); schemaIssues++; }
        if (!t.inputSchema || typeof t.inputSchema !== 'object') { failures.push(`${t.name}: missing inputSchema`); schemaIssues++; continue; }
        if (t.inputSchema.type !== 'object') { failures.push(`${t.name}: inputSchema.type must be 'object'`); schemaIssues++; }
        if (t.inputSchema.properties && typeof t.inputSchema.properties !== 'object') { failures.push(`${t.name}: inputSchema.properties not an object`); schemaIssues++; }
        if (t.inputSchema.required && !Array.isArray(t.inputSchema.required)) { failures.push(`${t.name}: inputSchema.required not an array`); schemaIssues++; }
    }
    console.log(`Schema validity: ${schemaIssues === 0 ? 'PASS' : 'FAIL'} (${schemaIssues} issues)`);

    // --- Parity vs golden -------------------------------------------
    let goldenExists = false;
    try { await access(GOLDEN); goldenExists = true; } catch {}

    if (check && !goldenExists) {
        // --check must never conjure the thing it is asserting.
        failures.push(`no golden snapshot at ${GOLDEN} — run with --update and commit the result`);
    } else if (!goldenExists || update) {
        await writeFile(GOLDEN, JSON.stringify(snapshotOf(tools), null, 2) + '\n');
        console.log(`Golden ${goldenExists ? 'updated' : 'created'}: ${GOLDEN}`);
    } else {
        const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));
        const goldenNames = new Set(golden.map(g => g.name));
        const liveNames   = new Set(tools.map(t => t.name));

        const removed = [...goldenNames].filter(n => !liveNames.has(n)).sort();
        const added   = [...liveNames].filter(n => !goldenNames.has(n)).sort();

        if (removed.length) {
            failures.push(`removed since golden (${removed.length}): ${removed.join(', ')}`);
            console.log(`REMOVED tools: ${removed.length}`);
            removed.forEach(n => console.log(`  - ${n}`));
        }
        if (added.length) {
            // Under --check an added tool IS staleness: the committed snapshot
            // no longer describes the server.
            if (check) failures.push(`added since golden (${added.length}): ${added.join(', ')}`);
            console.log(`ADDED tools: ${added.length}${check ? '' : '  (not a failure, but record with --update if intentional)'}`);
            added.forEach(n => console.log(`  + ${n}`));
        }

        // Drift on overlap — descriptions and schemas both.
        const drift = [];
        for (const t of tools) {
            const g = golden.find(x => x.name === t.name);
            if (!g) continue;
            const fields = [];
            if (t.description !== g.description) fields.push('description');
            if (JSON.stringify(t.inputSchema) !== JSON.stringify(g.inputSchema)) fields.push('inputSchema');
            if (fields.length) drift.push(`${t.name} (${fields.join(', ')})`);
        }
        drift.slice(0, 5).forEach(d => failures.push(`drift: ${d}`));
        if (drift.length > 5) failures.push(`...and ${drift.length - 5} more drifts`);
        console.log(`Drift on overlap: ${drift.length}`);

        const stale = removed.length > 0 || drift.length > 0 || (check && added.length > 0);
        console.log(`Parity: ${stale ? 'FAIL' : 'PASS'}`);
        if (stale) {
            console.log(`\ntools.golden.json no longer matches the server.`);
            console.log(`Run: node scripts/test/phase0-parity.mjs --update   and commit the result.`);
        }
    }
} catch (e) {
    failures.push(`fatal: ${e.message}`);
} finally {
    client.close();
}

if (failures.length) {
    console.log('\n=== FAILURES ===');
    failures.forEach(f => console.log(`  ${f}`));
    process.exit(1);
}
console.log('\nPhase 0: PASS');
