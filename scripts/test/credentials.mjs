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

/**
 * Read FIBARO_* from a systemd EnvironmentFile.
 *
 * On a deployed unit the credentials are in /etc/hc3-mcp/.env (the path
 * DEPLOYMENT.md sets up) and are read by systemd, not by any shell — so a
 * maintainer sshing in and running a probe has no FIBARO_* and no
 * ~/.claude.json either. Without this, every tool here works on a laptop and
 * fails on the machine actually talking to the gateway.
 *
 * HC3_ENV_FILE overrides, so this is not tied to one layout.
 */
function fromEnvFile() {
  const candidates = [process.env.HC3_ENV_FILE, '/etc/hc3-mcp/.env'].filter(Boolean);
  for (const file of candidates) {
    let raw;
    try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    const picked = {};
    for (const line of raw.split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const [, k, v] = m;
      if (KEYS.includes(k)) picked[k] = v.replace(/^["']|["']$/g, '');
    }
    if (picked.FIBARO_HOST) return { source: file, env: picked };
  }
  return null;
}

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
  const found = fromEnvFile() ?? fromClientConfig();
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
      'No HC3 credentials found. Looked in, in order:\n' +
      '  1. the shell environment (FIBARO_HOST)\n' +
      `  2. ${process.env.HC3_ENV_FILE ?? '/etc/hc3-mcp/.env'} — the deployed unit's EnvironmentFile\n` +
      '  3. ~/.claude.json, for an MCP server entry carrying FIBARO_HOST\n\n' +
      '  On a deployed unit the env file is usually mode 0750 and owned by the\n' +
      '  service user, so run as that user (e.g. sudo -u hc3mcp), or point\n' +
      '  HC3_ENV_FILE at a readable copy, or export the three variables.'
    );
  }
  return { env, source };
}
