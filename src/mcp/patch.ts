// Text primitives: exact-match edits, unified diff rendering, and the
// excerpting used by the partial-read paths.
//
// Why this exists: HC3's write endpoints take a whole file. That is fine for
// the gateway and ruinous for the caller — a one-line fix to a 58 KB QuickApp
// engine costs the whole 58 KB to express, so above a certain file size the
// write tools stop being usable at all. These functions let a tool accept a
// *change* and do the whole-file PUT itself.
//
// Pure functions: no HC3 coupling, no I/O, no `this`. Everything here is
// exercised by scripts/test/unit-patch.mjs without a gateway.

export interface PatchEdit {
  /** Exact text to find. Must match `count` times or the whole patch aborts. */
  old: string;
  /** Replacement text. May be empty (a deletion). */
  new: string;
  /** Required number of occurrences. Default 1. */
  count?: number;
}

export interface AppliedEdit {
  index: number;
  occurrences: number;
  bytesDelta: number;
}

export interface ApplyResult {
  content: string;
  applied: AppliedEdit[];
}

/** Non-overlapping occurrence count. Plain scan — `old` is literal, never a regex. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let n = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return n;
    n++;
    from = at + needle.length;
  }
}

/** Replace every non-overlapping occurrence. No regex, so `$&` etc. stay literal. */
function replaceAll(haystack: string, needle: string, replacement: string): string {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      parts.push(haystack.slice(from));
      return parts.join(replacement);
    }
    parts.push(haystack.slice(from, at));
    from = at + needle.length;
  }
}

/** Collapse runs of whitespace so a near-miss can be reported as such. */
function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** One-line, length-capped rendering of a snippet for error messages. */
function preview(s: string, max = 120): string {
  const flat = s.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  return flat.length <= max ? JSON.stringify(flat) : JSON.stringify(flat.slice(0, max) + '…');
}

/**
 * Apply edits to `original`, in order, each against the running result.
 *
 * Throws — before returning anything — if any edit does not match exactly
 * `count` times. That refusal is the entire point: a whole-file write is
 * always structurally valid, so the server has no way to know it is wrong,
 * whereas an edit that does not fit its file is self-evidently wrong. Callers
 * must not write anything when this throws.
 */
export function applyEdits(original: string, edits: PatchEdit[], label = 'patch'): ApplyResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error(`${label}: edits must be a non-empty array of {old, new} objects.`);
  }

  let working = original;
  const applied: AppliedEdit[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const where = `edit ${i + 1} of ${edits.length}`;

    if (!edit || typeof edit !== 'object') {
      throw new Error(`${label}: ${where} is not an object. Each edit is {old, new, count?}.`);
    }
    if (typeof edit.old !== 'string' || edit.old === '') {
      throw new Error(
        `${label}: ${where} has a missing or empty 'old'. ` +
        `'old' is the exact existing text to replace and cannot be empty — ` +
        `to append or prepend, anchor on a nearby line and include it in both 'old' and 'new'.`
      );
    }
    if (typeof edit.new !== 'string') {
      throw new Error(
        `${label}: ${where} has a missing or non-string 'new'. ` +
        `Use an empty string to delete the matched text.`
      );
    }
    if (edit.old === edit.new) {
      throw new Error(
        `${label}: ${where} has identical 'old' and 'new' — it would change nothing. ` +
        `Nothing was written; correct or drop the edit.`
      );
    }

    const expected = edit.count === undefined ? 1 : edit.count;
    if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
      throw new Error(
        `${label}: ${where} has count=${JSON.stringify(edit.count)}. ` +
        `count must be a positive integer (it is the number of occurrences you expect, default 1).`
      );
    }

    const found = countOccurrences(working, edit.old);
    if (found !== expected) {
      let why: string;
      if (found === 0) {
        why =
          `The text was not found. It must match byte for byte, including indentation, ` +
          `tabs vs spaces, and line endings.`;
        if (normaliseWhitespace(working).includes(normaliseWhitespace(edit.old)) &&
            normaliseWhitespace(edit.old) !== '') {
          why +=
            ` A whitespace-insensitive search DOES find it, so the difference is ` +
            `whitespace — re-fetch the file and copy the text exactly as stored.`;
        } else {
          why += ` Re-fetch the file: your copy may be stale.`;
        }
      } else if (found < expected) {
        why = `Found ${found}, expected ${expected}. Lower 'count', or make 'old' less specific.`;
      } else {
        why =
          `Found ${found}, expected ${expected}. Set count=${found} to change them all, ` +
          `or extend 'old' with surrounding lines so it identifies one place uniquely.`;
      }
      throw new Error(
        `${label} refused ${where}: ${why}\n` +
        `Nothing was written — the target is unchanged, including any earlier edits in this patch.\n` +
        `old: ${preview(edit.old)}`
      );
    }

    const before = working.length;
    working = expected === 1
      ? working.replace(edit.old, () => edit.new)
      : replaceAll(working, edit.old, edit.new);
    applied.push({ index: i, occurrences: expected, bytesDelta: working.length - before });
  }

  if (working === original) {
    throw new Error(
      `${label}: the edits applied cleanly but produced content identical to the original. ` +
      `Nothing was written.`
    );
  }

  return { content: working, applied };
}

// ---------------------------------------------------------------------------
// Unified diff
// ---------------------------------------------------------------------------

type OpKind = 'eq' | 'del' | 'add';
interface Op { kind: OpKind; line: string; oldNo: number | null; newNo: number | null }

// A full LCS table is O(n*m) cells. The prefix/suffix trim below means the
// table only ever spans the changed region, but a pathological input (a file
// reordered wholesale) could still blow up — cap it and degrade to a coarse
// replace rather than allocating gigabytes.
const MAX_LCS_CELLS = 4_000_000;

function diffLines(a: string[], b: string[]): { kind: OpKind; line: string }[] {
  if (a.length === 0) return b.map(line => ({ kind: 'add' as OpKind, line }));
  if (b.length === 0) return a.map(line => ({ kind: 'del' as OpKind, line }));
  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      ...a.map(line => ({ kind: 'del' as OpKind, line })),
      ...b.map(line => ({ kind: 'add' as OpKind, line })),
    ];
  }

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const out: { kind: OpKind; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'eq', line: a[i] });
      i++; j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      out.push({ kind: 'del', line: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', line: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'del', line: a[i++] });
  while (j < m) out.push({ kind: 'add', line: b[j++] });
  return out;
}

export interface DiffOptions {
  fromLabel?: string;
  toLabel?: string;
  /** Unchanged lines shown either side of each change. Default 3. */
  context?: number;
  /** Cap on rendered body lines; the point of this tool is small responses. Default 400. */
  maxLines?: number;
}

/**
 * Render a unified diff of two texts.
 *
 * Informational — it is meant to be read (by a person or a model) to confirm a
 * change landed where intended, not fed to `patch(1)`. No newline-at-EOF
 * markers are emitted.
 */
export function unifiedDiff(before: string, after: string, opts: DiffOptions = {}): string {
  const context = opts.context ?? 3;
  const maxLines = opts.maxLines ?? 400;
  const fromLabel = opts.fromLabel ?? 'before';
  const toLabel = opts.toLabel ?? 'after';

  if (before === after) return '';

  const A = before.split('\n');
  const B = after.split('\n');

  // Trim the common head and tail so the O(n*m) core only spans the edited
  // region — the localised change this tool exists to make.
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (
    suf < A.length - pre &&
    suf < B.length - pre &&
    A[A.length - 1 - suf] === B[B.length - 1 - suf]
  ) suf++;

  const middle = diffLines(A.slice(pre, A.length - suf), B.slice(pre, B.length - suf));

  const raw: { kind: OpKind; line: string }[] = [
    ...A.slice(0, pre).map(line => ({ kind: 'eq' as OpKind, line })),
    ...middle,
    ...A.slice(A.length - suf).map(line => ({ kind: 'eq' as OpKind, line })),
  ];

  let oldNo = 0;
  let newNo = 0;
  const ops: Op[] = raw.map(op => ({
    kind: op.kind,
    line: op.line,
    oldNo: op.kind === 'add' ? null : ++oldNo,
    newNo: op.kind === 'del' ? null : ++newNo,
  }));

  const changed = ops.map((op, idx) => (op.kind === 'eq' ? -1 : idx)).filter(idx => idx >= 0);
  if (changed.length === 0) return '';

  // Group changes that share context into one hunk.
  const groups: Array<[number, number]> = [];
  let start = changed[0];
  let end = changed[0];
  for (const idx of changed.slice(1)) {
    if (idx - end <= context * 2) {
      end = idx;
    } else {
      groups.push([start, end]);
      start = idx;
      end = idx;
    }
  }
  groups.push([start, end]);

  const body: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  let truncated = 0;

  for (const [gStart, gEnd] of groups) {
    const from = Math.max(0, gStart - context);
    const to = Math.min(ops.length - 1, gEnd + context);
    const slice = ops.slice(from, to + 1);

    const oldCount = slice.filter(op => op.kind !== 'add').length;
    const newCount = slice.filter(op => op.kind !== 'del').length;
    const oldStart = slice.find(op => op.oldNo !== null)?.oldNo ?? 0;
    const newStart = slice.find(op => op.newNo !== null)?.newNo ?? 0;

    if (body.length + slice.length > maxLines) {
      truncated += slice.length;
      continue;
    }

    body.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) {
      body.push(`${op.kind === 'eq' ? ' ' : op.kind === 'del' ? '-' : '+'}${op.line}`);
    }
  }

  if (truncated > 0) {
    body.push(`… diff truncated: ${truncated} further line(s) suppressed at maxLines=${maxLines}.`);
  }

  return body.join('\n');
}

// ---------------------------------------------------------------------------
// Excerpting — read the bit, not the file
// ---------------------------------------------------------------------------

export interface ExcerptRequest {
  /** 1-indexed inclusive first line. */
  startLine?: number;
  /** 1-indexed inclusive last line. */
  endLine?: number;
  /** Literal substring to find; every matching line is returned with context. */
  contains?: string;
  /** Unchanged lines either side of a `contains` hit. Default 3. */
  contextLines?: number;
  /** Cap on returned lines, so a loose filter cannot return the whole file. Default 200. */
  maxLines?: number;
}

export interface ExcerptResult {
  excerpt: string;
  totalLines: number;
  returnedLines: number;
  /** Present for a `contains` query: how many lines matched. */
  matchCount?: number;
  truncated: boolean;
  /** Set when the request asked for something the content cannot supply. */
  note?: string;
}

/**
 * Return part of a body, with 1-indexed line-number gutters so the caller can
 * quote what it sees straight back into a patch `old`.
 *
 * `startLine`/`endLine` and `contains` compose: the range narrows first, then
 * the filter runs inside it.
 */
export function excerpt(content: string, req: ExcerptRequest): ExcerptResult {
  const all = content.split('\n');
  const totalLines = all.length;
  const maxLines = req.maxLines ?? 200;
  const contextLines = req.contextLines ?? 3;

  const from = Math.max(1, req.startLine ?? 1);
  const to = Math.min(totalLines, req.endLine ?? totalLines);
  if (from > totalLines) {
    return {
      excerpt: '',
      totalLines,
      returnedLines: 0,
      truncated: false,
      note: `startLine ${from} is past the end of the content (${totalLines} lines).`,
    };
  }
  if (req.endLine !== undefined && req.endLine < from) {
    throw new Error(`excerpt: endLine (${req.endLine}) is before startLine (${from}).`);
  }

  // Which 1-indexed line numbers to show.
  let wanted: number[];
  let matchCount: number | undefined;
  let note: string | undefined;

  if (req.contains !== undefined && req.contains !== '') {
    const hits: number[] = [];
    for (let ln = from; ln <= to; ln++) {
      if (all[ln - 1].includes(req.contains)) hits.push(ln);
    }
    matchCount = hits.length;
    if (hits.length === 0) {
      return {
        excerpt: '',
        totalLines,
        returnedLines: 0,
        matchCount: 0,
        truncated: false,
        note: `No line contains ${JSON.stringify(req.contains)}${req.startLine || req.endLine ? ` within lines ${from}-${to}` : ''}. The search is literal and case-sensitive.`,
      };
    }
    const keep = new Set<number>();
    for (const h of hits) {
      for (let ln = Math.max(from, h - contextLines); ln <= Math.min(to, h + contextLines); ln++) {
        keep.add(ln);
      }
    }
    wanted = [...keep].sort((a, b) => a - b);
  } else {
    wanted = [];
    for (let ln = from; ln <= to; ln++) wanted.push(ln);
  }

  const truncated = wanted.length > maxLines;
  if (truncated) {
    note = `Showing the first ${maxLines} of ${wanted.length} selected lines (maxLines). Narrow the range or raise maxLines.`;
    wanted = wanted.slice(0, maxLines);
  }

  // Gutter width from the largest number actually shown.
  const width = String(wanted.length ? wanted[wanted.length - 1] : 1).length;
  const rendered: string[] = [];
  let prev: number | null = null;
  for (const ln of wanted) {
    if (prev !== null && ln !== prev + 1) rendered.push('  …');
    rendered.push(`${String(ln).padStart(width, ' ')}| ${all[ln - 1]}`);
    prev = ln;
  }

  return {
    excerpt: rendered.join('\n'),
    totalLines,
    returnedLines: wanted.length,
    ...(matchCount !== undefined ? { matchCount } : {}),
    truncated,
    ...(note ? { note } : {}),
  };
}

/** True when the caller asked for any kind of excerpt. */
export function wantsExcerpt(req: ExcerptRequest | undefined): boolean {
  if (!req) return false;
  return req.startLine !== undefined || req.endLine !== undefined ||
    (req.contains !== undefined && req.contains !== '');
}
