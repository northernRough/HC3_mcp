// Top-level argument validation against a tool's declared inputSchema.
//
// Only checks NAMES, not types: every handler already coerces or guards its
// own values, and a type check here would duplicate (and could contradict)
// those. The point is narrower: an argument the tool does not declare is one
// the handler never reads, so the caller's intent would be silently lost.

import { MCPTool } from './types';

/** Edit distance, small strings only. */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** The declared parameter a mistaken name most likely meant, if any. */
export function closest(name: string, declared: string[]): string | undefined {
  const n = name.toLowerCase();
  // Prefix/containment first: exact -> exactMatch, file -> fileName.
  const contained = declared.filter(d => d.toLowerCase().startsWith(n) || n.startsWith(d.toLowerCase()) || d.toLowerCase().includes(n));
  if (contained.length === 1) return contained[0];
  let best: string | undefined, bestD = Infinity;
  for (const d of declared) {
    const dd = distance(n, d.toLowerCase());
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return bestD <= Math.max(2, Math.floor(n.length / 3)) ? best : undefined;
}

/** An error message if `args` carries names the schema does not declare;
 *  undefined if all is well (or the schema allows anything). */
export function unknownArguments(schema: MCPTool | undefined, args: any): string | undefined {
  const s: any = schema?.inputSchema;
  if (!s || s.additionalProperties === true) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const declared = Object.keys(s.properties ?? {});
  const unknown = Object.keys(args).filter(k => !declared.includes(k));
  if (unknown.length === 0) return undefined;
  const hints = unknown.map(u => {
    const c = closest(u, declared);
    return c ? `'${u}' (did you mean '${c}'?)` : `'${u}'`;
  });
  return (
    `${schema!.name}: unknown argument${unknown.length > 1 ? 's' : ''} ${hints.join(', ')}. Nothing was done. ` +
    `This tool accepts: ${declared.length ? declared.join(', ') : '(no arguments)'}.`
  );
}

/** An error message naming EVERY required argument that is missing, or
 *  undefined. Before 4.35.0 nothing enforced `required`: get_quickapp_variable
 *  without `name` answered exists:false about variables that exist (finding
 *  1794098612), set_quickapp_variable looked up a variable called
 *  'undefined', and report_finding refused one missing field per call, so
 *  filing one finding could take four round trips. */
export function missingArguments(schema: MCPTool | undefined, args: any): string | undefined {
  const s: any = schema?.inputSchema;
  const required: string[] = Array.isArray(s?.required) ? s.required : [];
  if (required.length === 0) return undefined;
  const a = args && typeof args === 'object' ? args : {};
  const missing = required.filter(k => a[k] === undefined || a[k] === null);
  if (missing.length === 0) return undefined;
  const describe = (k: string) => {
    const d = s?.properties?.[k]?.description;
    return d ? `${k} (${String(d).split(/(?<=\.)\s/)[0].slice(0, 120)})` : k;
  };
  return `${schema!.name}: missing required argument${missing.length > 1 ? 's' : ''}: ${missing.map(describe).join('; ')}. Nothing was done.`;
}
