// Credentials for anything that spawns the server against a live gateway.
//
// The live phases spawned the server with a bare `process.env`, which on a
// normal developer shell carries no FIBARO_* variables — so every live phase
// reported "Fibaro HC3 not configured" and 53 of 58 tools recorded an error.
// That read as a broken test tier for months. It was a missing environment.
//
// probe.mjs already solved this by falling back to the MCP client config, so
// the fix is to share that rather than ask people to export secrets into a
// shell. Generalised here: probe.mjs looks up `mcpServers.hc3`, which assumes
// the server happens to be keyed "hc3". Any key works below, chosen by which
// entry actually carries a FIBARO_HOST.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEYS = ['FIBARO_HOST', 'FIBARO_PORT', 'FIBARO_USERNAME', 'FIBARO_PASSWORD'];

/** Read FIBARO_* from an MCP client config, whatever the server is named. */
function fromClientConfig() {
  for (const file of [join(homedir(), '.claude.json')]) {
    let cfg;
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    const servers = cfg?.mcpServers ?? {};
    for (const [name, def] of Object.entries(servers)) {
      const env = def?.env;
      if (env?.FIBARO_HOST) {
        const picked = {};
        for (const k of KEYS) if (env[k] !== undefined) picked[k] = String(env[k]);
        return { source: `${file} → mcpServers.${name}`, env: picked };
      }
    }
  }
  return null;
}

/**
 * Environment for spawning the server against a live gateway.
 * Shell variables win, so a run can be pointed at a different gateway without
 * touching any config file.
 */
export function serverEnv(base = process.env) {
  if (base.FIBARO_HOST) return { env: { ...base }, source: 'shell environment' };
  const found = fromClientConfig();
  if (!found) return { env: { ...base }, source: null };
  return { env: { ...base, ...found.env }, source: found.source };
}

/** Host being targeted, for stamping a run. Never returns the password. */
export function targetHost(env = serverEnv().env) {
  return env.FIBARO_HOST ? `${env.FIBARO_HOST}:${env.FIBARO_PORT ?? 80}` : null;
}

/** Fail loudly and usefully rather than letting every call error identically. */
export function requireCredentials() {
  const { env, source } = serverEnv();
  if (!env.FIBARO_HOST) {
    throw new Error(
      'No HC3 credentials found.\n' +
      '  Looked in: the shell environment (FIBARO_HOST), then ~/.claude.json for an\n' +
      '  MCP server entry carrying FIBARO_HOST.\n\n' +
      '  Either export FIBARO_HOST / FIBARO_USERNAME / FIBARO_PASSWORD, or run this\n' +
      '  on a machine whose MCP client config already has them.'
    );
  }
  return { env, source };
}
