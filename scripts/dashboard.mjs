#!/usr/bin/env node
// Render the MCP Resources into one self-contained HTML page.
//
// The resources are the source of truth; this is a view over them, so the
// page cannot drift from what the server reports. Re-run it to refresh —
// a rendered page is a snapshot, and the timestamp says which one.
//
// Output is a single file with inlined CSS and no external requests, so it
// works offline and never phones home with your home's topology.
//
//   node scripts/dashboard.mjs [outfile]
//
// Credentials come from the environment (FIBARO_HOST / FIBARO_USERNAME /
// FIBARO_PASSWORD), the same as the server. Nothing is written to HC3.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const { HC3Client } = await import(resolve(ROOT, 'out/mcp/hc3-client.js'));
const { RESOURCES, readResource } = await import(resolve(ROOT, 'out/mcp/resources.js'));

const outFile = resolve(process.argv[2] ?? resolve(ROOT, 'hc3-dashboard.html'));
const hc3 = HC3Client.fromEnv();

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal Markdown -> HTML. The resources emit a deliberately small subset:
// headings, tables, bold, inline code, italics, paragraphs.
function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let table = null;

  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*_])_([^_]+)_(?![*_])/g, '$1<em>$2</em>');

  const flush = () => {
    if (!table) return;
    const [head, ...body] = table;
    out.push('<div class="scroll"><table><thead><tr>'
      + head.map(c => `<th>${inline(c)}</th>`).join('')
      + '</tr></thead><tbody>'
      + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table></div>');
    table = null;
  };

  for (const line of lines) {
    const isRow = /^\|.*\|\s*$/.test(line);
    if (isRow) {
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^-+$/.test(c))) continue;   // separator row
      (table ??= []).push(cells);
      continue;
    }
    flush();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (line.trim() === '') continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n');
}

const CSS = `
:root { color-scheme: light dark;
  --bg:#fbfbfa; --fg:#1f1f1d; --muted:#6b6b66; --line:#e3e3df; --card:#fff;
  --accent:#3d6b4a; --warn:#a4442f; }
@media (prefers-color-scheme: dark) { :root {
  --bg:#191917; --fg:#e9e9e4; --muted:#9a9a92; --line:#33332f; --card:#212120;
  --accent:#8fbf9f; --warn:#e08b73; } }
* { box-sizing:border-box; }
body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
  font:16px/1.6 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif; }
.wrap { max-width:1100px; margin:0 auto; }
header { border-bottom:2px solid var(--line); padding-bottom:1rem; margin-bottom:2rem; }
h1 { font-size:1.6rem; margin:0 0 .25rem; letter-spacing:-.01em; }
.sub { color:var(--muted); font-size:.85rem; }
section { background:var(--card); border:1px solid var(--line); border-radius:10px;
  padding:1.25rem 1.5rem; margin-bottom:1.5rem; }
section > h1 { font-size:1.15rem; color:var(--accent); border-bottom:1px solid var(--line);
  padding-bottom:.5rem; margin-bottom:1rem; }
h2 { font-size:1rem; margin:1.5rem 0 .5rem; }
h3 { font-size:.9rem; margin:1.25rem 0 .5rem; color:var(--muted);
  text-transform:uppercase; letter-spacing:.04em; }
p { margin:.5rem 0; }
code { font:.85em ui-monospace,SFMono-Regular,Menlo,monospace;
  background:color-mix(in srgb, var(--fg) 8%, transparent); padding:.1em .35em; border-radius:4px; }
strong { color:var(--warn); }
.scroll { overflow-x:auto; margin:.75rem 0; }
table { border-collapse:collapse; width:100%; font-size:.85rem; }
th,td { text-align:left; padding:.45rem .7rem; border-bottom:1px solid var(--line); white-space:nowrap; }
th { font-weight:600; color:var(--muted); font-size:.75rem;
  text-transform:uppercase; letter-spacing:.04em; }
tbody tr:last-child td { border-bottom:none; }
tbody tr:hover { background:color-mix(in srgb, var(--fg) 4%, transparent); }
footer { color:var(--muted); font-size:.8rem; text-align:center; margin-top:2rem; }
`;

const sections = [];
let failed = 0;
for (const r of RESOURCES) {
  try {
    const res = await readResource(hc3, r.uri);
    sections.push(`<section>${mdToHtml(res.contents[0].text)}
      <p class="sub">source: <code>${esc(r.uri)}</code></p></section>`);
    console.log(`  rendered ${r.uri}`);
  } catch (e) {
    failed++;
    sections.push(`<section><h1>${esc(r.name)}</h1>
      <p><strong>Failed to render ${esc(r.uri)}</strong></p>
      <p><code>${esc(e.message)}</code></p></section>`);
    console.error(`  FAILED   ${r.uri}: ${e.message}`);
  }
}

const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
writeFileSync(outFile, `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HC3 status — ${esc(stamp)}</title><style>${CSS}</style></head>
<body><div class="wrap">
<header>
  <h1>HC3 status</h1>
  <div class="sub">Snapshot taken ${esc(stamp)} UTC · ${esc(hc3.config.host)} · regenerate with <code>node scripts/dashboard.mjs</code></div>
</header>
${sections.join('\n')}
<footer>Rendered from MCP resources. This is a snapshot, not a live view.</footer>
</div></body></html>
`);

console.log(`\nWrote ${outFile}`);
process.exit(failed ? 1 : 0);
