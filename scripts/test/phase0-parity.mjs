#!/usr/bin/env node
// Phase 0 — registration parity + schema validity check.
//
// Spawns the modularised server, lists tools, and:
//   1. validates each tool has name/description/inputSchema with required shape;
//   2. compares against tools.golden.json (if exists) — diffs reported but not fatal;
//   3. writes the current tool list to tools.golden.json on first run (use --update to overwrite).
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
const failures = [];

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

    if (!goldenExists || update) {
        const snapshot = tools
            .map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        await writeFile(GOLDEN, JSON.stringify(snapshot, null, 2) + '\n');
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
            console.log(`ADDED tools: ${added.length}  (not a failure, but record with --update if intentional)`);
            added.forEach(n => console.log(`  + ${n}`));
        }

        // Schema drift on overlap
        let schemaDrift = 0;
        for (const t of tools) {
            const g = golden.find(x => x.name === t.name);
            if (!g) continue;
            const liveJson = JSON.stringify(t.inputSchema);
            const goldJson = JSON.stringify(g.inputSchema);
            if (liveJson !== goldJson) {
                schemaDrift++;
                if (schemaDrift <= 5) failures.push(`schema drift: ${t.name}`);
            }
        }
        if (schemaDrift > 5) failures.push(`...and ${schemaDrift - 5} more schema drifts`);
        console.log(`Schema drift on overlap: ${schemaDrift}`);
        console.log(`Parity: ${removed.length === 0 && schemaDrift === 0 ? 'PASS' : 'FAIL'}`);
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
