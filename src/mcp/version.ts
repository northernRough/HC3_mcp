// Single source of truth for the MCP server's name/version. Reads
// package.json at module load so the value stays in sync with the
// shipped npm tarball — no hard-coded version drift across releases.

import * as fs from 'node:fs';
import * as path from 'node:path';

function loadPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

export const SERVER_NAME = 'hc3-mcp-server';
export const SERVER_VERSION = loadPackageVersion();
