#!/usr/bin/env node
// Phase 1 — read-only sweep against the live HC3.
//
// For each tool whose name matches a read-only prefix, calls it with sensible
// defaults from default-args.mjs and records:
//   - success/failure
//   - JSON-structure summary (top-level key shape) for diffing against baseline
// Outputs a per-tool report and writes shapes to shapes.snapshot.json.
//
// Use --baseline to write shapes.baseline.json on first run.
// Subsequent runs diff shapes.snapshot.json against shapes.baseline.json.

import { MCPClient } from './mcp-client.mjs';
import { defaultArgsFor } from './default-args.mjs';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SERVER = resolve(PROJECT_ROOT, 'out/mcp/hc3-mcp-server.js');
const SHAPES_BASELINE = resolve(__dirname, 'shapes.baseline.json');
const SHAPES_SNAPSHOT = resolve(__dirname, 'shapes.snapshot.json');

const updateBaseline = process.argv.includes('--baseline');
const READ_ONLY = /^(get|list|find|filter|explain|audit|read|snapshot|can)_/;

// Build a shape descriptor from any JSON value.
//   primitives -> typeof
//   arrays     -> ["array(N)", element-shape-of-first-item]
//   objects    -> sorted "{k1:shape, k2:shape, ...}"
function shape(v, depth = 0) {
    if (depth > 3) return '…';
    if (v === null) return 'null';
    if (Array.isArray(v)) return `array(${v.length})${v.length ? '<' + shape(v[0], depth+1) + '>' : ''}`;
    if (typeof v === 'object') {
        const keys = Object.keys(v).sort();
        return `{${keys.map(k => `${k}:${shape(v[k], depth+1)}`).join(',')}}`;
    }
    return typeof v;
}

// Tool result is wrapped: { content: [{ type: 'text', text: '<json>' }] }
function unwrap(result) {
    if (!result || !result.content) return result;
    const first = result.content[0];
    if (first?.type === 'text') {
        try { return JSON.parse(first.text); } catch { return first.text; }
    }
    return result;
}

const client = new MCPClient({ serverPath: SERVER });
const summary = { total: 0, called: 0, ok: 0, error: 0, skipped: 0, missingDefault: [] };
const shapes = {};
const failures = [];

try {
    await client.initialize();
    // Optional --tools=foo,bar filter for iterating on a single tool
const filterArg = process.argv.find(a => a.startsWith('--tools='));
const onlyTools = filterArg ? new Set(filterArg.slice('--tools='.length).split(',').map(s => s.trim()).filter(Boolean)) : null;

let tools = (await client.rpc('tools/list')).result.tools.filter(t => READ_ONLY.test(t.name));
if (onlyTools) tools = tools.filter(t => onlyTools.has(t.name));
    summary.total = tools.length;
    console.log(`Read-only tools to exercise: ${tools.length}\n`);

    for (const t of tools) {
        const args = defaultArgsFor(t.name);
        if (args === null) {
            summary.skipped++;
            summary.missingDefault.push(t.name);
            continue;
        }
        summary.called++;
        let res;
        try {
            res = await client.rpc('tools/call', { name: t.name, arguments: args }, 30000);
        } catch (e) {
            summary.error++;
            failures.push({ tool: t.name, kind: 'rpc-timeout', detail: e.message });
            console.log(`  ✗ ${t.name}  TIMEOUT`);
            continue;
        }
        if (res.error) {
            summary.error++;
            failures.push({ tool: t.name, kind: 'rpc-error', detail: res.error });
            console.log(`  ✗ ${t.name}  ${res.error.code}: ${(res.error.message || '').slice(0, 80)}`);
            continue;
        }
        // Tool may return a successful MCP envelope but with isError=true content
        if (res.result?.isError) {
            summary.error++;
            const txt = res.result.content?.[0]?.text || '';
            failures.push({ tool: t.name, kind: 'tool-error', detail: txt.slice(0, 200) });
            console.log(`  ✗ ${t.name}  TOOL_ERROR: ${txt.slice(0, 80)}`);
            continue;
        }
        summary.ok++;
        const payload = unwrap(res.result);
        shapes[t.name] = shape(payload);
        console.log(`  ✓ ${t.name}  ${shapes[t.name].slice(0, 90)}`);
    }
} finally {
    client.close();
}

// Persist shapes
await writeFile(SHAPES_SNAPSHOT, JSON.stringify(shapes, null, 2) + '\n');

// Per-run timestamped report
const RUNS_DIR = resolve(__dirname, 'runs');
const { mkdir } = await import('node:fs/promises');
await mkdir(RUNS_DIR, { recursive: true });
const isoStamp = new Date().toISOString().replace(/[:.]/g, '-');
const runFile = resolve(RUNS_DIR, `phase1-${isoStamp}.json`);
await writeFile(runFile, JSON.stringify({
    when: new Date().toISOString(),
    summary, shapes, failures,
}, null, 2) + '\n');
console.log(`\nRun saved: ${runFile.replace(PROJECT_ROOT + '/', '')}`);

// Compare to baseline if it exists
let baselineExists = false;
try { await access(SHAPES_BASELINE); baselineExists = true; } catch {}

let drift = 0;
if (!baselineExists || updateBaseline) {
    await writeFile(SHAPES_BASELINE, JSON.stringify(shapes, null, 2) + '\n');
    console.log(`\nBaseline ${baselineExists ? 'updated' : 'created'}.`);
} else {
    const baseline = JSON.parse(await readFile(SHAPES_BASELINE, 'utf8'));
    for (const [name, sh] of Object.entries(shapes)) {
        if (baseline[name] && baseline[name] !== sh) {
            drift++;
            if (drift <= 10) failures.push({ tool: name, kind: 'shape-drift',
                detail: `was: ${baseline[name].slice(0,80)}\n  now: ${sh.slice(0,80)}` });
        }
    }
}

console.log('\n=== Summary ===');
console.log(`  total read-only tools: ${summary.total}`);
console.log(`  called:                ${summary.called}`);
console.log(`  ok:                    ${summary.ok}`);
console.log(`  errors:                ${summary.error}`);
console.log(`  skipped (no default):  ${summary.skipped}`);
console.log(`  shape drift vs baseline: ${drift}`);

if (summary.missingDefault.length) {
    console.log(`\nTools without default args (add to default-args.mjs):`);
    summary.missingDefault.forEach(n => console.log(`  ${n}`));
}

if (failures.length) {
    console.log(`\n=== Failures (${failures.length}) ===`);
    for (const f of failures) {
        console.log(`  ${f.tool}  [${f.kind}]`);
        if (typeof f.detail === 'string') console.log(`    ${f.detail.slice(0,200)}`);
        else console.log(`    ${JSON.stringify(f.detail).slice(0,200)}`);
    }
    process.exit(1);
}
console.log('\nPhase 1: PASS');
