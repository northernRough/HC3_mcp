#!/usr/bin/env node
// Phase 6 — endpoint auditor.
// Greps every hc3.request('...') call site in src/**/*.ts, substitutes fixture
// values for ${...} interpolation, probes each unique URL against live HC3, and
// classifies the outcome. Catches dead endpoints (e.g. get_energy_data → /api/energy → 500)
// before users hit them.

import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SRC_DIR = resolve(PROJECT_ROOT, 'src');

const HOST = process.env.FIBARO_HOST;
const PORT = process.env.FIBARO_PORT || '80';
const USER = process.env.FIBARO_USERNAME;
const PASS = process.env.FIBARO_PASSWORD;
if (!HOST || !USER || !PASS) {
    console.error('Missing FIBARO_HOST / FIBARO_USERNAME / FIBARO_PASSWORD env'); process.exit(2);
}
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

// Fixtures used to substitute ${...} placeholders in URL templates.
// Pulled from known-good entities on the originating HC3 (10.0.1.3).
const FIXTURES = {
    deviceId:     4742,    quickAppId: 4742,   devId:    4742,
    sceneId:      670,     roomId:     367,
    childId:      2370,    parentId:   2367,
    nodeId:       30,      userId:     2,
    name:         'RoomMgrHeartbeat',
    varName:      'RoomMgrHeartbeat',
    fileName:     'main',
    propertyName: 'value',
    profileId:    1,       zoneId:     1,        partitionId: 1,
    eventName:    'trigDriveLights',
    iconId:       1,
    pluginId:     'com.fibaro.cameraGeneric',
    interfaceId:  'security',
    pluginType:   'com.fibaro.cameraGeneric',
    ts:           Date.now(),       // for delete-action timestamps
    endpoint:     '__SKIP__',       // when the URL is a parameter, not a literal
};

function substitute(template) {
    return template.replace(/\$\{([^}]+)\}/g, (m, expr) => {
        // Strip args. and args?. prefixes; take the leaf identifier
        const leaf = expr.replace(/^args[?.]\.?/, '').replace(/^encodeURIComponent\(/, '').replace(/\).*$/, '').trim();
        const id = leaf.split(/[.\s]/)[0];
        if (FIXTURES[id] !== undefined) return String(FIXTURES[id]);
        return `__UNFILLED_${id}__`;
    });
}

async function* walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(p);
        else if (entry.isFile() && entry.name.endsWith('.ts')) yield p;
    }
}

// hc3.request('...') / makeApiRequest('...') — both forms; capture template-string and plain
const RE = /(?:hc3|client|this)\.(?:request|makeApiRequest)\s*\(\s*([`'"])((?:\\.|(?!\1).)*)\1\s*(?:,\s*([`'"])(\w+)\3)?/g;
const ALSO = /makeApiRequest\s*\(\s*([`'"])((?:\\.|(?!\1).)*)\1/g;

async function collectCallSites() {
    const sites = [];
    for await (const file of walk(SRC_DIR)) {
        const src = await readFile(file, 'utf8');
        const lines = src.split('\n');
        lines.forEach((line, idx) => {
            for (const m of line.matchAll(RE)) {
                sites.push({ file: relative(PROJECT_ROOT, file), line: idx+1, template: m[2], method: m[4] || 'GET', probeUrl: substitute(m[2]) });
            }
            for (const m of line.matchAll(ALSO)) {
                sites.push({ file: relative(PROJECT_ROOT, file), line: idx+1, template: m[2], method: 'GET',     probeUrl: substitute(m[2]) });
            }
        });
    }
    // De-dupe within the same line (RE + ALSO can both match)
    const seen = new Set();
    return sites.filter(s => { const k = `${s.file}:${s.line}:${s.template}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function probe(path, method='GET') {
    const url = `http://${HOST}:${PORT}${path.startsWith('/') ? path : '/' + path}`;
    try {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { method, headers: { Authorization: AUTH }, signal: ctrl.signal });
        clearTimeout(timer);
        const text = await r.text();
        return { status: r.status, length: text.length, body: text.slice(0, 200) };
    } catch (e) { return { status: -1, length: 0, body: String(e).slice(0, 200) }; }
}

function classify(probeUrl, status, length) {
    if (probeUrl.includes('__UNFILLED_'))   return 'UNPROBED';
    if (probeUrl.includes('__SKIP__'))      return 'SKIPPED';
    if (status === 200 && length === 0)     return 'EMPTY_BODY';
    if (status === 200)                     return 'OK';
    if (status === 404)                     return 'DEAD_404';
    if (status === 500)                     return 'DEAD_500';
    if (status === 501)                     return 'DEAD_501';
    if (status >= 400 && status < 500)      return 'CLIENT_ERROR';
    if (status >= 500)                      return 'SERVER_ERROR';
    if (status === -1)                      return 'TRANSPORT_ERROR';
    return `HTTP_${status}`;
}

const sites = await collectCallSites();
console.log(`Found ${sites.length} hc3.request/makeApiRequest call sites.`);

const byUrl = new Map();
for (const s of sites) {
    const key = `${s.method} ${s.probeUrl}`;
    if (!byUrl.has(key)) byUrl.set(key, { ...s, callSites: [] });
    byUrl.get(key).callSites.push(`${s.file}:${s.line}`);
}
console.log(`Unique probe URL+method combos: ${byUrl.size}\n`);

const results = [];
let i = 0;
for (const [key, meta] of byUrl) {
    i++;
    process.stdout.write(`\r  probing ${i}/${byUrl.size}…  `);
    // Skip non-GET probes (mutation; can't safely audit) and unfilled / skipped
    if (meta.method !== 'GET' || meta.probeUrl.includes('__UNFILLED_') || meta.probeUrl.includes('__SKIP__')) {
        results.push({ ...meta, classification: meta.method !== 'GET' ? 'NON_GET' : classify(meta.probeUrl, 0, 0), status: 0, length: 0, body: '' });
        continue;
    }
    const r = await probe(meta.probeUrl, meta.method);
    results.push({ ...meta, classification: classify(meta.probeUrl, r.status, r.length), ...r });
}
process.stdout.write('\n\n');

const groups = {};
for (const r of results) (groups[r.classification] ||= []).push(r);

const order = ['DEAD_404','DEAD_500','DEAD_501','SERVER_ERROR','EMPTY_BODY','TRANSPORT_ERROR','CLIENT_ERROR','UNPROBED','NON_GET','SKIPPED','OK'];
let dead = 0;
for (const cls of order) {
    const items = groups[cls] || []; if (!items.length) continue;
    console.log(`=== ${cls} (${items.length}) ===`);
    for (const r of items) {
        if (cls === 'OK') {
            console.log(`  ${r.method} ${r.probeUrl}    [${r.length}B]`);
        } else {
            console.log(`  ${r.method} ${r.probeUrl}`);
            console.log(`    template: ${r.template}`);
            console.log(`    sites:    ${r.callSites.slice(0,4).join(', ')}${r.callSites.length>4 ? ` (+${r.callSites.length-4})`:''}`);
            if (r.status > 0) console.log(`    status:   HTTP ${r.status}, ${r.length}B`);
            if (r.body && r.status !== 200) console.log(`    body:     ${r.body.replace(/\n/g,' ').slice(0,140)}`);
            console.log('');
        }
    }
    if (cls.startsWith('DEAD') || cls === 'SERVER_ERROR') dead += items.length;
    if (cls === 'OK') console.log('');
}

console.log(`=== Summary ===`);
for (const cls of order) console.log(`  ${cls.padEnd(18)} ${(groups[cls] || []).length}`);
console.log(`  TOTAL              ${results.length}`);

if (dead > 0) {
    console.log(`\n${dead} dead endpoint(s) found. Tools using these will fail.`);
    process.exit(1);
}
console.log('\nPhase 6: PASS (no dead endpoints)');
