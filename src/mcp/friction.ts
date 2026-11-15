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
import { SERVER_VERSION } from './version';

const MAX_BYTES = 512 * 1024;   // ~2-3k entries; small enough to read whole
const MAX_MESSAGE = 400;

/**
 * Per-field caps on a submitted finding.
 *
 * Set from what the caps were actually costing, not from a guess. In this
 * project's own log, 11 of the 20 findings carrying an `impact` sat exactly on
 * the old 500-character cap and 3 `actual` fields sat on the old 1000 — cut
 * off mid-sentence, silently, in the field where the cost and the suggested
 * fix live. `reproduction` at 4000 had never once been hit, so it is unchanged
 * and the others are raised towards it.
 *
 * The truncation is now marked in the stored text and reported back to the
 * caller (see `truncateField`). A cap has to exist — an unbounded field on a
 * size-capped log just evicts other people's findings faster — but a cap the
 * reporter cannot see is the same silent-success shape this server exists to
 * close.
 */
export const FINDING_LIMITS = {
  expected: 2000,
  actual: 4000,
  reproduction: 4000,
  impact: 4000,
  reporter: 120,
} as const;

export type FindingField = keyof typeof FINDING_LIMITS;

export interface Truncation {
  field: string;
  /** Characters submitted, after redaction. */
  submitted: number;
  /** Characters kept, excluding the marker. */
  kept: number;
}

/**
 * Cut to the cap, and say so in the text itself.
 *
 * The marker matters more than the limit. A reader of the log cannot
 * distinguish a report that stopped from one that was stopped, and four of the
 * eleven truncated impacts read as complete sentences that simply end early.
 */
export function truncateField(
  field: string, text: string, limit: number, out: Truncation[],
): string {
  if (text.length <= limit) return text;
  out.push({ field, submitted: text.length, kept: limit });
  return text.slice(0, limit) +
    `\n\n[…truncated: ${text.length - limit} of ${text.length} characters cut, the report_finding cap for \`${field}\` is ${limit}]`;
}

export interface FrictionEntry {
  at: number;
  kind: 'failure' | 'finding';
  tool: string;
  /**
   * Server version that recorded this entry.
   *
   * Without it, "was this seen after the fix shipped?" cannot be answered:
   * a release date says when a fix EXISTED, not when this gateway ran it, and
   * deploy lag makes every entry in that window look like a fix that failed.
   * Optional because entries written before 4.31.0 do not carry it.
   */
  v?: string;
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
    //
    // Findings are exempt from the first pass. A failure is one automatic line
    // that will recur the next time anyone hits it; a finding is a written
    // report with a reproduction, and once evicted it is gone for good. They
    // are also the minority — 21 of 104 entries here — so keeping them costs
    // little. Only if dropping every eligible failure still leaves the file
    // over cap does the halving fall back to dropping findings too.
    try {
      if (existsSync(path) && statSync(path).size > MAX_BYTES) {
        const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
        const drop = Math.floor(lines.length / 2);
        const isFinding = (l: string) => { try { return JSON.parse(l)?.kind === 'finding'; } catch { return false; } };
        let dropped = 0;
        let kept = lines.filter(l => {
          if (dropped >= drop) return true;
          if (isFinding(l)) return true;
          dropped++;
          return false;
        });
        // Still over: the file is mostly findings, so fall back to oldest-first.
        if (dropped < drop) kept = kept.slice(drop - dropped);
        writeFileSync(path, kept.join('\n') + '\n');
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
    // Marked, not silent: 10 of the 83 failures in this project's log sit on
    // this cap, and a message that stops mid-word reads as one the tool
    // produced that way. The cap itself stays low — failures are the
    // high-volume class and a long HC3 stack traceback adds nothing after the
    // first lines.
    const clean = truncateField('message', redact(String(message)), MAX_MESSAGE, []);
    append({
      at: Math.floor(Date.now() / 1000),
      kind: 'failure',
      v: SERVER_VERSION,
      tool: String(tool || 'unknown'),
      message: clean,
      signature: signature(message),
    });
  } catch { /* never throw */ }
}

/**
 * Record a human/agent-submitted finding via report_finding.
 *
 * Returns what it had to cut, so `report_finding` can tell the reporter in the
 * same turn — while they still have the text and can re-file the missing half.
 * Still never throws: an empty list is returned on any internal failure, and
 * `recorded` in the tool result is what says whether it persisted.
 */
export function recordFinding(tool: string, f: NonNullable<FrictionEntry['finding']>): Truncation[] {
  const cut: Truncation[] = [];
  try {
    const field = (name: FindingField, text: string) =>
      truncateField(name, redact(text), FINDING_LIMITS[name], cut);
    append({
      at: Math.floor(Date.now() / 1000),
      kind: 'finding',
      v: SERVER_VERSION,
      tool: String(tool || 'unknown'),
      // Not truncation-marked: this is a deliberate short summary for the
      // triage table, and the full text is in `finding` on the same entry.
      message: redact(f.expected + ' / ' + f.actual).slice(0, MAX_MESSAGE),
      signature: signature(f.actual),
      finding: {
        expected: field('expected', f.expected),
        actual: field('actual', f.actual),
        reproduction: field('reproduction', f.reproduction),
        ...(f.impact ? { impact: field('impact', f.impact) } : {}),
        ...(f.reporter ? { reporter: field('reporter', f.reporter) } : {}),
      },
    });
  } catch { /* never throw */ }
  return cut;
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
  /** Server version of the most recent entry, when it recorded one. */
  lastVersion?: string;
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
      if (e.at >= g.lastSeen) { g.lastSeen = e.at; g.lastVersion = e.v; }
    } else {
      map.set(key, {
        tool: e.tool, signature: e.signature, count: 1,
        firstSeen: e.at, lastSeen: e.at, example: e.message, lastVersion: e.v,
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

// ---------------------------------------------------------------------------
// Verdicts
//
// The generated triage table and the hc3://friction resource both listed every
// row with no verdict at all — the file hard-coded "untested", the resource
// showed nothing. That was a documented limitation until it became a defect:
// rows fixed in 4.19.2 and 4.21.2 were still reading as open candidates, and a
// finding whose own text began "RESOLVED IN 4.26.0" sat under a hard-coded
// untested. A triage surface that misreports its own state costs more than one
// with gaps, because the gaps do not argue with you.
//
// Telemetry cannot know any of this: it records failures, not whether anyone
// fixed them. So the verdicts live in friction-verdicts.json, hand-maintained
// and shipped with the package, and are joined on here — in ONE place, used by
// both the script and the resource, because two copies of this logic is how
// the get_icon/upload_icon contradiction happened.
// ---------------------------------------------------------------------------

export interface Verdict {
  tool: string;
  /** Exact normalised signature, or use signatureContains. */
  signature?: string;
  signatureContains?: string;
  /** Findings are keyed by their unique `at` epoch. */
  at?: number;
  verdict: 'confirmed' | 'refuted' | 'untested' | 'by-design';
  resolvedIn?: string;
  resolvedAt?: number;
  note?: string;
}

/** Package root, from out/mcp/ (compiled) — two levels up. */
function packageRoot(): string {
  return join(__dirname, '..', '..');
}

export function loadVerdicts(root?: string): { failures: Verdict[]; findings: Verdict[]; present: boolean } {
  try {
    const raw = readFileSync(join(root ?? packageRoot(), 'friction-verdicts.json'), 'utf8');
    const v = JSON.parse(raw);
    return {
      failures: Array.isArray(v.failures) ? v.failures : [],
      findings: Array.isArray(v.findings) ? v.findings : [],
      present: true,
    };
  } catch {
    // Absent or unreadable is not an error here: every row simply reads
    // untested, which is the safe default. The triage SCRIPT is stricter and
    // refuses on a malformed file, because that is the surface that writes
    // a committed document.
    return { failures: [], findings: [], present: false };
  }
}

export function matchFailureVerdict(verdicts: Verdict[], g: FrictionGroup): Verdict | undefined {
  return verdicts.find(v => v.tool === g.tool && (
    v.signature !== undefined
      ? v.signature === g.signature
      : (v.signatureContains !== undefined && g.signature.includes(v.signatureContains))
  ));
}

/** The bare tool name: a client may report a tool with its connector prefix
 *  (`mcp__<server>__get_icon`, `<server>:get_icon`), and the connector name can
 *  be personal, so verdicts are keyed by the bare name. */
export function bareToolName(t: string): string {
  return String(t ?? '').split('__').pop()!.split(':').pop()!.trim();
}

export function matchFindingVerdict(verdicts: Verdict[], e: FrictionEntry): Verdict | undefined {
  return verdicts.find(v => v.at === e.at && bareToolName(v.tool) === bareToolName(e.tool));
}

/** Numeric compare of dotted versions. <0, 0, >0. */
export function cmpVersion(a: string, b: string): number {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Has this row occurred on a build that already contained its claimed fix?
 *
 * Only the recorded VERSION can answer that. `resolvedAt` is a release date,
 * and a release date says when a fix existed, not when this gateway ran it —
 * with deploy lag every entry in that window looks like a fix that failed. The
 * first pass of this check flagged two rows for precisely that reason and both
 * were entries recorded days before the unit was updated. So a contradiction
 * requires version evidence; a date-only discrepancy is reported elsewhere as
 * something to look at, never asserted.
 */
export function verdictContradicted(v: Verdict | undefined, g: FrictionGroup | undefined): boolean {
  return !!v?.resolvedIn && !!g?.lastVersion && cmpVersion(g.lastVersion, v.resolvedIn) >= 0;
}

/** Date-only discrepancy on an entry too old to carry a version. */
export function verdictSuspect(v: Verdict | undefined, g: FrictionGroup | undefined): boolean {
  return v?.resolvedAt !== undefined && g?.lastVersion === undefined && (g?.lastSeen ?? 0) > v.resolvedAt;
}

export function verdictLabel(v: Verdict | undefined, g?: FrictionGroup): string {
  if (!v) return 'untested';
  const fixed = v.resolvedIn ? `, fixed ${v.resolvedIn}` : '';
  const flag = verdictContradicted(v, g) ? ` **⚠ SEEN SINCE ON ${g!.lastVersion}**` : '';
  return `${v.verdict}${fixed}${flag}`;
}
