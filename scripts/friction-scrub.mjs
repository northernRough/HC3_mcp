#!/usr/bin/env node
// Strip personal details from FRICTION.md before it is committed. The file is
// public, and the friction log it is generated from carries whatever a session
// wrote: the owner's name, the home's name, family members' room names, LAN
// addresses.
//
// Two layers:
//   1. Built in: private IPv4 addresses (10/8, 172.16/12, 192.168/16) become
//      the documentation range 192.0.2.x, as the LAN layout did in 4.24.0.
//   2. Local rules, NOT committed: a JSON array of [regex, replacement] pairs
//      read from $FRICTION_SCRUB, else /etc/hc3-mcp/friction-scrub.json, else
//      ~/.hc3-mcp/friction-scrub.json. Names live there so that this public
//      source never lists them.
//
//   node scripts/friction-scrub.mjs [file]      # rewrite in place (default FRICTION.md)
//
// friction-triage.mjs applies the same scrub to everything it writes.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRIVATE_IPV4 = /\b(?:10\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}|192\.168\.\d{1,3})\.(\d{1,3})\b/g;

export function scrubRulesPath(env = process.env) {
  const candidates = [env.FRICTION_SCRUB, '/etc/hc3-mcp/friction-scrub.json', join(homedir(), '.hc3-mcp', 'friction-scrub.json')];
  return candidates.find(p => p && existsSync(p)) ?? null;
}

export function loadScrubRules(path = scrubRulesPath()) {
  if (!path) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw) || raw.some(r => !Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'string' || typeof r[1] !== 'string')) {
    throw new Error(`${path}: expected a JSON array of [regex, replacement] string pairs`);
  }
  return raw.map(([re, rep]) => [new RegExp(re, 'g'), rep]);
}

export function scrub(text, rules = []) {
  let out = text.replace(PRIVATE_IPV4, (_m, last) => `192.0.2.${last}`);
  for (const [re, rep] of rules) out = out.replace(re, rep);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'FRICTION.md'));
  const path = scrubRulesPath();
  const rules = loadScrubRules(path);
  const before = readFileSync(file, 'utf8');
  const after = scrub(before, rules);
  writeFileSync(file, after);
  const changed = before.split('\n').filter((l, i) => l !== after.split('\n')[i]).length;
  console.log(`${file}: ${changed} line(s) changed, ${rules.length} local rule(s) from ${path ?? '(none found)'}`);
}
