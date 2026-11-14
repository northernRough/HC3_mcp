// Write log — a record of every QuickApp / scene write this server attempts.
//
// Why it exists: the Pi's nightly hc3-snapshot job diffs QuickApp files and
// scene Lua between snapshots and alerts on any change "made outside the MCP".
// On 2026-11-13 a disabled helper QuickApp (4983) ran its onInit on gateway
// boot and copied a retired build over the live Shading QA (4984); nothing
// noticed for hours. The alert can only tell that apart from legitimate work
// done through Claude if this server says what IT wrote. This file is that
// statement; the snapshot reads it and stays quiet about anything listed here
// since its previous run.
//
// Format, one JSON object per line (the snapshot job's README specifies it):
//   {"at": <epoch seconds>, "kind": "QuickApp"|"scene", "deviceId"|"sceneId": n,
//    "tool": "<tool name>", "ok": true|false}
//
// Attempts are logged whether or not the call threw: a multi-file PUT that
// fails verification may still have changed the gateway, and a missed alert
// is the cheaper error only when we know we touched the object.
//
// Best-effort and local, like friction.ts: never allowed to affect a response.

import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

type Kind = 'QuickApp' | 'scene';

/** tool -> how to find the object it wrote. `fromResult` covers create tools,
 *  whose id only exists once HC3 has answered. */
const WRITE_TOOLS: Record<string, { kind: Kind; arg?: string; fromResult?: boolean }> = {
  create_quickapp_file:           { kind: 'QuickApp', arg: 'deviceId' },
  update_quickapp_file:           { kind: 'QuickApp', arg: 'deviceId' },
  update_multiple_quickapp_files: { kind: 'QuickApp', arg: 'deviceId' },
  patch_quickapp_file:            { kind: 'QuickApp', arg: 'deviceId' },
  delete_quickapp_file:           { kind: 'QuickApp', arg: 'deviceId' },
  set_quickapp_variable:          { kind: 'QuickApp', arg: 'deviceId' },
  set_quickapp_variables:         { kind: 'QuickApp', arg: 'deviceId' },
  create_quickapp_variable:       { kind: 'QuickApp', arg: 'deviceId' },
  delete_quickapp_variable:       { kind: 'QuickApp', arg: 'deviceId' },
  restore_quickapp_from_snapshot: { kind: 'QuickApp', arg: 'deviceId' },
  modify_device:                  { kind: 'QuickApp', arg: 'deviceId' },
  delete_device:                  { kind: 'QuickApp', arg: 'deviceId' },
  create_quickapp:                { kind: 'QuickApp', fromResult: true },
  import_quickapp:                { kind: 'QuickApp', fromResult: true },
  modify_scene:                   { kind: 'scene', arg: 'sceneId' },
  delete_scene:                   { kind: 'scene', arg: 'sceneId' },
  update_scene_content:           { kind: 'scene', arg: 'sceneId' },
  patch_scene_content:            { kind: 'scene', arg: 'sceneId' },
  create_scene:                   { kind: 'scene', fromResult: true },
  sync_dimmer_tuner:              { kind: 'QuickApp', fromResult: true },
  calibrate_dimmer:               { kind: 'QuickApp', fromResult: true },   // only when it updated the Dimmer Tuner register
  restore_dimmer_settings:        { kind: 'QuickApp', fromResult: true },   // only when it updated the Dimmer Tuner register
};

const MAX_BYTES = 1_000_000;   // trim to the newest half beyond this
let resolvedPath: string | null | undefined;

export function writeLogPath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  const off = (v: string | undefined) => String(v).toLowerCase() === 'true';
  if (off(process.env.MCP_WRITE_LOG_DISABLE) || off(process.env.MCP_FRICTION_DISABLE)) {
    return (resolvedPath = null);
  }
  // Same rule as friction.ts: an explicit path is an instruction, not a
  // preference. If it cannot be used, logging disables itself.
  const explicit = process.env.MCP_WRITE_LOG;
  const candidates = explicit && explicit.length > 0 ? [explicit] : [
    '/var/lib/hc3-mcp/mcp-writes.jsonl',
    join(homedir() || '/tmp', '.hc3-mcp', 'mcp-writes.jsonl'),
    join(tmpdir(), 'hc3-mcp-writes.jsonl'),
  ];
  for (const c of candidates) {
    try {
      mkdirSync(dirname(c), { recursive: true });
      appendFileSync(c, '');
      return (resolvedPath = c);
    } catch { /* next */ }
  }
  return (resolvedPath = null);
}

/** For tests. */
export function resetWriteLogPathCache(): void {
  resolvedPath = undefined;
}

function idFromResult(result: any): number | undefined {
  if (!result || typeof result !== 'object') return undefined;
  for (const k of ['id', 'deviceId', 'sceneId', 'quickAppId']) {
    const v = Number(result[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

/** Build the log entry for a tool call, or null if the tool is not a write. */
export function writeEntry(tool: string, args: any, result: any, ok: boolean, now = Date.now()) {
  const spec = WRITE_TOOLS[tool];
  if (!spec) return null;
  const raw = spec.fromResult ? idFromResult(result) : Number(args?.[spec.arg as string]);
  const id = Number.isFinite(raw) && (raw as number) > 0 ? raw : undefined;
  if (id === undefined) return null;
  const idKey = spec.kind === 'scene' ? 'sceneId' : 'deviceId';
  return { at: Math.floor(now / 1000), kind: spec.kind, [idKey]: id, tool, ok };
}

export function recordWrite(tool: string, args: any, result: any, ok: boolean): void {
  try {
    const entry = writeEntry(tool, args, result, ok);
    if (!entry) return;
    const path = writeLogPath();
    if (!path) return;
    appendFileSync(path, JSON.stringify(entry) + '\n');
    if (statSync(path).size > MAX_BYTES) {
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      writeFileSync(path, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
    }
  } catch { /* never affects the response */ }
}
