// Friction telemetry — where this server wastes people's time.
//
// Every tool failure is already structured (4.15.0 returns isError results),
// so the signal exists whether or not anyone writes a report. Repeated
// identical failures against one tool mean a description gap or a real bug.
// This records them locally and surfaces them as hc3://friction.
//
// Three rules, in priority order:
//
//   1. NEVER break a tool call. Every write is wrapped and every failure is
//      swallowed. A telemetry bug must not become an outage on a live home
//      automation controller.
//   2. Local only. Nothing is transmitted anywhere. HC3 error bodies carry
//      device and room names, so this is the same rule as hc3-snapshot.
//   3. Redact before writing, not before reading. If a secret never reaches
//      the file it cannot leak from it later.
//
// Storage: JSONL, size-capped with oldest-first truncation. The path is
// MCP_FRICTION_LOG, else the first writable candidate. Under a hardened
// systemd unit (ProtectSystem=strict) there may be none, in which case
// telemetry disables itself and the resource says so rather than pretending
// to have data. Set MCP_FRICTION_DISABLE=true to switch it off entirely.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_BYTES = 512 * 1024;   // ~2-3k entries; small enough to read whole
const MAX_MESSAGE = 400;

export interface FrictionEntry {
  at: number;
  kind: 'failure' | 'finding';
  tool: string;
  message: string;
  signature: string;
  /** Present only on `finding` entries submitted via report_finding. */
  finding?: {
    expected: string;
    actual: string;
    reproduction: string;
    impact?: string;
    reporter?: string;
  };
}

let resolvedPath: string | null | undefined;   // undefined = not yet resolved

/** First writable candidate, or null if telemetry cannot persist here. */
export function frictionPath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  if (String(process.env.MCP_FRICTION_DISABLE).toLowerCase() === 'true') {
    return (resolvedPath = null);
  }
  // An explicit MCP_FRICTION_LOG is an instruction about WHERE, not a first
  // preference: if it cannot be used, telemetry disables itself rather than
  // writing somewhere the operator did not name. Falling through was a real
  // leak, not a hypothetical — every `npm test` run put its fixture entries
  // into the developer's own ~/.hc3-mcp log, because the unwritable-path test
  // set the variable and the resolver quietly moved on to the next candidate.
  const explicit = process.env.MCP_FRICTION_LOG;
  const candidates = (explicit && explicit.length > 0 ? [explicit] : [
    // A hardened unit needs StateDirectory=hc3-mcp for this one to be writable.
    '/var/lib/hc3-mcp/friction.jsonl',
    join(homedir() || '/tmp', '.hc3-mcp', 'friction.jsonl'),
    join(tmpdir(), 'hc3-mcp-friction.jsonl'),
  ]);

  for (const candidate of candidates) {
    try {
      mkdirSync(dirname(candidate), { recursive: true });
      // Prove writability now rather than discovering it mid-incident.
      appendFileSync(candidate, '');
      return (resolvedPath = candidate);
    } catch { /* try the next one */ }
  }
  return (resolvedPath = null);
}

/** For tests: forget the cached path so env changes take effect. */
export function _resetFrictionPath(): void { resolvedPath = undefined; }

/**
 * Strip anything that could be a secret. Deliberately aggressive: a false
 * positive costs a few redacted characters in a local log; a false negative
 * writes a credential to disk.
 */
export function redact(text: string): string {
  return String(text)
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .replace(/Bearer\s+[\w.\-]+/gi, 'Bearer [redacted]')
    .replace(/("?(?:password|passwd|pass|token|secret|apikey|api_key|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      (_m, k) => `${k}[redacted]`)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]');
}

/**
 * Collapse a message to a grouping key: the same fault reported about
 * different ids must land in one bucket, or nothing ever looks recurring.
 */
export function signature(message: string): string {
  return redact(message)
    .replace(/User\d+/g, 'User<N>')
    .replace(/\b\d{9,}\b/g, '<epoch>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/'[^']{0,80}'/g, "'<v>'")
    .replace(/"[^"]{0,80}"/g, '"<v>"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function append(entry: FrictionEntry): void {
  const path = frictionPath();
  if (!path) return;
  try {
    // Truncate oldest-first when the cap is hit. Losing old telemetry is
    // acceptable; unbounded growth on someone's gateway is not.
    try {
      if (existsSync(path) && statSync(path).size > MAX_BYTES) {
        const kept = readFileSync(path, 'utf8').split('\n').filter(Boolean);
        writeFileSync(path, kept.slice(Math.floor(kept.length / 2)).join('\n') + '\n');
      }
    } catch { /* rotation is best-effort */ }
    appendFileSync(path, JSON.stringify(entry) + '\n');
  } catch { /* rule 1: never break the call */ }
}

/**
 * Is this the server saying it has no credentials, rather than a defect?
 *
 * Not friction, and not merely uninteresting: it is the ONE failure class that
 * arrives in bulk. A misconfigured environment does not fail one call, it fails
 * every call — the 2026-08-15 burst in this project's own log was 159 entries
 * from two seconds, 60% of the file, because a test harness spawned the server
 * with a bare process.env and all 58 tools failed identically, twice. That
 * volume then outranked every real fault in the triage table, which sorts by
 * count. So this class does not just add noise, it displaces signal.
 *
 * Deliberately narrow and anchored. This predicate decides what is NEVER
 * written down, so it must fail OPEN: a boring entry kept costs a line, a real
 * failure dropped costs the evidence. Widening it to anything mentioning
 * configuration or environment variables would swallow gateway errors that
 * merely say those words.
 *
 * Routing errors (Unknown tool / Unknown resource) are deliberately NOT here,
 * though they share the finding-nudge exemption below. A run of them is the
 * documented stale-schema symptom — schemas cache at connect and a reconnect
 * may not refresh them after a redeploy — so it is exactly the kind of thing
 * the log should show.
 */
export function isConfigurationError(message: string): boolean {
  return /^Fibaro HC3 not configured/i.test(String(message ?? ''));
}

/** Record a tool failure. Called from the tools/call error path. */
export function recordFailure(tool: string, message: string): void {
  try {
    if (isConfigurationError(message)) return;
    const clean = redact(String(message)).slice(0, MAX_MESSAGE);
    append({
      at: Math.floor(Date.now() / 1000),
      kind: 'failure',
      tool: String(tool || 'unknown'),
      message: clean,
      signature: signature(message),
    });
  } catch { /* never throw */ }
}

/** Record a human/agent-submitted finding via report_finding. */
export function recordFinding(tool: string, f: NonNullable<FrictionEntry['finding']>): void {
  try {
    append({
      at: Math.floor(Date.now() / 1000),
      kind: 'finding',
      tool: String(tool || 'unknown'),
      message: redact(f.expected + ' / ' + f.actual).slice(0, MAX_MESSAGE),
      signature: signature(f.actual),
      finding: {
        expected: redact(f.expected).slice(0, 1000),
        actual: redact(f.actual).slice(0, 1000),
        reproduction: redact(f.reproduction).slice(0, 4000),
        ...(f.impact ? { impact: redact(f.impact).slice(0, 500) } : {}),
        ...(f.reporter ? { reporter: redact(f.reporter).slice(0, 120) } : {}),
      },
    });
  } catch { /* never throw */ }
}

export function readEntries(): FrictionEntry[] {
  const path = frictionPath();
  if (!path || !existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l) as FrictionEntry; } catch { return null; } })
      .filter((e): e is FrictionEntry => !!e && typeof e.at === 'number');
  } catch {
    return [];
  }
}

export interface FrictionGroup {
  tool: string;
  signature: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  example: string;
}

/** Group failures by (tool, signature), most frequent first. */
export function groupFailures(entries: FrictionEntry[]): FrictionGroup[] {
  const map = new Map<string, FrictionGroup>();
  for (const e of entries) {
    if (e.kind !== 'failure') continue;
    const key = `${e.tool}\0${e.signature}`;
    const g = map.get(key);
    if (g) {
      g.count++;
      g.firstSeen = Math.min(g.firstSeen, e.at);
      g.lastSeen = Math.max(g.lastSeen, e.at);
    } else {
      map.set(key, {
        tool: e.tool, signature: e.signature, count: 1,
        firstSeen: e.at, lastSeen: e.at, example: e.message,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}

/**
 * Should this error end with a nudge to file a finding?
 *
 * A tool error is one of two things: this server refusing a call it can see is
 * wrong, or something the caller did not expect. Only the second is worth a
 * finding. Appending the prompt to the first would fill the friction log with
 * the guards working correctly, and train everyone to ignore the line — the
 * fastest way to waste the channel is to fire it on every refusal.
 *
 * A post-write verification failure is the case that must NOT be missed: it is
 * phrased like a local refusal because this server raises it, but it means the
 * write said yes and the read-back said no, which is precisely the class this
 * server exists to catch.
 */
export function invitesAFinding(tool: string, message: string): boolean {
  // Configuration errors are not recorded at all (see isConfigurationError);
  // this keeps the nudge correct for any caller that reaches here another way.
  if (isConfigurationError(message)) return false;
  if (/^(Unknown tool|Unknown resource)/i.test(message)) return false;
  // Verification mismatches first: they are worth reporting even though this
  // server phrased them and even though they name the tool.
  if (/mismatch|did not (?:match|verify)|verif\w* failed|not verified|disagree/i.test(message)) return true;
  // Anything the gateway answered, including its 4xx/5xx bodies.
  if (/\bHTTP \d{3}\b/.test(message)) return true;
  // By convention every deliberate refusal here names its own tool first.
  if (message.startsWith(tool)) return false;
  return true;
}

export const FINDING_NUDGE =
  '\n\nIf this was unexpected, call report_finding now — while you still have the exact sequence. ' +
  'A finding filed next turn is usually a finding lost.';
