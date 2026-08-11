#!/usr/bin/env node
// Release hygiene checks. Pure verification — writes nothing, contacts nothing.
//
// Guards the drift that let npm sit twelve releases behind the repo and left
// v4.3.0..v4.7.0 untagged: every release-visible surface must agree on the
// version before the commit lands.
//
//   1. CHANGELOG.md's newest entry matches package.json's version.
//   2. That entry carries a plausible ISO date.
//   3. src/mcp/version.ts does not hard-code a version literal (it drifted
//      out of sync as '4.2.2' before 4.3.0 moved it to package.json).
//
//   node scripts/check-release-hygiene.mjs

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const changelog = await readFile(resolve(ROOT, 'CHANGELOG.md'), 'utf8');

// 1 + 2 — newest CHANGELOG entry agrees with package.json.
const entry = changelog.match(/^## \[([^\]]+)\](?:\s*-\s*(\S+))?/m);
if (!entry) {
  problems.push('CHANGELOG.md has no "## [version] - date" entry.');
} else {
  const [, version, date] = entry;
  if (version !== pkg.version) {
    problems.push(
      `Version mismatch: package.json is ${pkg.version} but the newest CHANGELOG entry is ${version}. ` +
      'Add a CHANGELOG entry for this release, or correct the version bump.'
    );
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    problems.push(`CHANGELOG entry [${version}] has a missing or malformed date (expected YYYY-MM-DD, got ${date ?? 'nothing'}).`);
  }
}

// 3 — the server version must still be sourced from package.json.
const versionSrc = await readFile(resolve(ROOT, 'src/mcp/version.ts'), 'utf8');
const hardCoded = versionSrc.match(/['"](\d+\.\d+\.\d+)['"]/);
if (hardCoded && hardCoded[1] !== '0.0.0') {
  problems.push(
    `src/mcp/version.ts appears to hard-code the version "${hardCoded[1]}". ` +
    'It must read from package.json at startup, or serverInfo.version drifts from the shipped tarball.'
  );
}

console.log(`package.json version: ${pkg.version}`);
if (problems.length === 0) {
  console.log('Release hygiene: PASS');
  process.exit(0);
}
console.error('\nRelease hygiene: FAIL');
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
