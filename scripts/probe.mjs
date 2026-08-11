#!/usr/bin/env node
// Reproduction scaffolding.
//
// A finding is only actionable with a reproduction that varies ONE thing.
// Writing one by hand means creating a throwaway object, changing a single
// field, asserting, and cleaning up — and the cleanup is the part people skip
// when they are in a hurry. A `delete_icon` used as a reachability probe
// destroyed a live user icon on this gateway for exactly that reason.
//
// These helpers guarantee teardown in `finally`, so a probe cannot leave
// debris even if it throws. Import them; do not copy them.
//
//   import { withQuickApp, withIcon, withGlobal, single } from './probe.mjs';
//
//   await withQuickApp(async (qa, hc3) => {
//     await single('selectionType decides whether the view renders', {
//       without: () => putLayout(qa, selectWithout()),
//       with:    () => putLayout(qa, selectWith()),
//       measure: () => countComponents(qa),
//     });
//   });
//
// Nothing here writes to a pre-existing object. If a probe needs to touch
// something live, that is a signal to build a throwaway that resembles it
// instead.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out/mcp');

export async function client() {
  const { HC3Client } = await import(path.join(OUT, 'hc3-client.js'));
  if (process.env.FIBARO_HOST) return HC3Client.fromEnv();
  // Fall back to the MCP client config so a probe works without exporting
  // credentials into the shell.
  const cfgPath = path.join(os.homedir(), '.claude.json');
  const env = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))?.mcpServers?.hc3?.env;
  if (!env) throw new Error('No FIBARO_HOST in env and no hc3 MCP config found.');
  return new HC3Client({
    host: env.FIBARO_HOST, port: Number(env.FIBARO_PORT || 80),
    username: env.FIBARO_USERNAME, password: env.FIBARO_PASSWORD,
  });
}

const stamp = () => `${Date.now().toString(36)}`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tools(name) {
  return (await import(path.join(OUT, 'tools', `${name}.js`)))[name];
}

/** Throwaway QuickApp, deleted in finally. */
export async function withQuickApp(fn, { type = 'com.fibaro.genericDevice' } = {}) {
  const hc3 = await client();
  const qa = await (await tools('quickapps')).handlers.create_quickapp(hc3, {
    name: `PROBE_${stamp()}`, type,
  });
  const id = qa?.deviceId ?? qa?.id;
  console.log(`  [probe] created QuickApp ${id} (${type})`);
  try {
    return await fn(id, hc3);
  } finally {
    try { await hc3.request(`/api/devices/${id}`, 'DELETE'); console.log(`  [probe] deleted QuickApp ${id}`); }
    catch (e) { console.error(`  [probe] FAILED to delete QuickApp ${id}: ${e.message}`); }
  }
}

/** Throwaway icon, deleted in finally. Device icons need a deviceTemplate. */
export async function withIcon(fn, { category = 'room', deviceTemplate, base64, states } = {}) {
  const hc3 = await client();
  const icons = await tools('icons');
  const args = { mime: 'image/png', category, ...(deviceTemplate ? { deviceTemplate } : {}) };
  if (states) args.states = states; else args.base64 = base64 ?? blankPng();
  const up = await icons.handlers.upload_icon(hc3, args);
  console.log(`  [probe] created icon ${up.newName} (${category})`);
  try {
    return await fn(up, hc3);
  } finally {
    try {
      await icons.handlers.delete_icon(hc3, { name: up.newName, fileExtension: up.extension, category });
      console.log(`  [probe] deleted icon ${up.newName}`);
    } catch (e) { console.error(`  [probe] FAILED to delete icon ${up.newName}: ${e.message}`); }
  }
}

/** Throwaway global variable, deleted in finally. */
export async function withGlobal(fn, { value = '0' } = {}) {
  const hc3 = await client();
  const name = `PROBE_${stamp()}`;
  await (await tools('globals')).handlers.create_global_variable(hc3, { varName: name, value });
  console.log(`  [probe] created global ${name}`);
  try {
    return await fn(name, hc3);
  } finally {
    try { await hc3.request(`/api/globalVariables/${name}`, 'DELETE'); console.log(`  [probe] deleted global ${name}`); }
    catch (e) { console.error(`  [probe] FAILED to delete global ${name}: ${e.message}`); }
  }
}

/**
 * The single-variable test. Runs both arms against the SAME object and
 * reports both measurements, so the result is a comparison rather than an
 * anecdote. Prints a verdict you can paste straight into report_finding.
 */
export async function single(claim, { without, with: withArm, measure, settleMs = 4000 }) {
  console.log(`\n  [single-variable] ${claim}`);
  await without();
  await sleep(settleMs);
  const a = await measure();
  await withArm();
  await sleep(settleMs);
  const b = await measure();
  const differs = JSON.stringify(a) !== JSON.stringify(b);
  console.log(`    without: ${JSON.stringify(a)}`);
  console.log(`    with   : ${JSON.stringify(b)}`);
  console.log(`    verdict: ${differs ? 'THE VARIABLE MATTERS' : 'no difference — this variable is not the cause'}`);
  if (!differs) {
    console.log('    (if you expected a difference, something else changed too — find it before reporting)');
  }
  return { differs, without: a, with: b, claim };
}

/** Minimal valid 128x128 PNG, for probes that just need a payload. */
export function blankPng() {
  return 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAAtJREFUeNrjYBgFAAAJAAGX8w4WAAAAAElFTkSuQmCC';
}
