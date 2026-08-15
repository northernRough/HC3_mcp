// A deliberately shallow Lua checker.
//
// This is NOT a parser and does not pretend to be one. It is a lexer that
// blanks strings and comments, then checks two things that are unambiguous
// once those are out of the way: bracket balance, and block-keyword balance
// (`function`/`if`/`do` … `end`, `repeat` … `until`).
//
// Why so little: the failure it guards is real — a scene that will not compile
// sits inert until its trigger fires, potentially at 03:00, with nothing to
// distinguish it from a trigger that never fired — but a FALSE refusal on a
// device holding irrigation valves open is worse than the gap it closes. So
// everything here is warn-only, and only fires on things that cannot be
// legitimate. A real parser would mean taking a runtime dependency, which is
// a bigger call than this file should make on its own.
//
// Pure, dependency-free, no I/O. Exercised by scripts/test/unit-lua.mjs.

export interface LuaWarning {
  code: string;
  message: string;
  line?: number;
}

/** `[[`, `[=[`, `[==[` … Returns the level and the offset just past it. */
function longBracketOpen(s: string, pos: number): { level: number; end: number } | null {
  if (s[pos] !== '[') return null;
  let k = pos + 1;
  while (s[k] === '=') k++;
  if (s[k] !== '[') return null;
  return { level: k - pos - 1, end: k + 1 };
}

function longBracketClose(s: string, from: number, level: number): number {
  const needle = ']' + '='.repeat(level) + ']';
  return s.indexOf(needle, from);
}

interface Lexed {
  /** Source with every string and comment blanked to spaces, newlines kept. */
  code: string;
  warnings: LuaWarning[];
}

function lex(source: string): Lexed {
  const out: string[] = [];
  const warnings: LuaWarning[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;

  // Blank a span, preserving newlines so later line numbers stay true.
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (source[k] === '\n') { out.push('\n'); line++; } else { out.push(' '); }
    }
  };

  while (i < n) {
    const c = source[i];

    // Comment: line or long.
    if (c === '-' && source[i + 1] === '-') {
      const lb = longBracketOpen(source, i + 2);
      if (lb) {
        const close = longBracketClose(source, lb.end, lb.level);
        if (close === -1) {
          warnings.push({
            code: 'LUA_UNTERMINATED_LONG_COMMENT',
            message: `Long comment opened here is never closed (expected ']${'='.repeat(lb.level)}]').`,
            line,
          });
          blank(i, n); i = n; continue;
        }
        blank(i, close + lb.level + 2);
        i = close + lb.level + 2;
        continue;
      }
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }

    // Long string.
    if (c === '[') {
      const lb = longBracketOpen(source, i);
      if (lb) {
        const close = longBracketClose(source, lb.end, lb.level);
        if (close === -1) {
          warnings.push({
            code: 'LUA_UNTERMINATED_LONG_STRING',
            message: `Long string opened here is never closed (expected ']${'='.repeat(lb.level)}]').`,
            line,
          });
          blank(i, n); i = n; continue;
        }
        blank(i, close + lb.level + 2);
        i = close + lb.level + 2;
        continue;
      }
    }

    // Short string.
    if (c === '"' || c === '\'') {
      const openedAt = line;
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = source[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;          // unescaped newline ends a short string in Lua
        if (d === c) { closed = true; j++; break; }
        j++;
      }
      if (!closed) {
        warnings.push({
          code: 'LUA_UNTERMINATED_STRING',
          message: `String opened with ${c} on this line is not closed before the line ends.`,
          line: openedAt,
        });
      }
      blank(i, j);
      i = j;
      continue;
    }

    if (c === '\n') { out.push('\n'); line++; i++; continue; }
    out.push(c);
    i++;
  }

  return { code: out.join(''), warnings };
}

const OPENERS = new Set(['function', 'if', 'do']);

/**
 * Check a Lua source for gross structural damage.
 *
 * Returns warnings — never throws, never blocks. An empty array means
 * "nothing obviously broken", NOT "this compiles".
 */
export function luaLint(source: string): LuaWarning[] {
  if (typeof source !== 'string' || source.trim() === '') return [];

  const { code, warnings } = lex(source);
  const out = [...warnings];

  // Bracket balance on code with strings and comments removed.
  const stack: Array<{ ch: string; line: number }> = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let line = 1;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '\n') { line++; continue; }
    if (c === '(' || c === '[' || c === '{') stack.push({ ch: c, line });
    else if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop();
      if (!top) {
        out.push({
          code: 'LUA_UNBALANCED_BRACKET',
          message: `Closing '${c}' with nothing open.`,
          line,
        });
        break;
      }
      if (top.ch !== pairs[c]) {
        out.push({
          code: 'LUA_UNBALANCED_BRACKET',
          message: `Closing '${c}' does not match '${top.ch}' opened on line ${top.line}.`,
          line,
        });
        break;
      }
    }
  }
  if (stack.length > 0) {
    const first = stack[0];
    out.push({
      code: 'LUA_UNBALANCED_BRACKET',
      message: `'${first.ch}' opened on line ${first.line} is never closed (${stack.length} unclosed in total).`,
      line: first.line,
    });
  }

  // Block balance. `for`/`while` are not counted: they are always followed by
  // their own `do`, which is. `elseif` is a distinct word and correctly misses
  // the `if` opener set.
  let depth = 0;
  let repeats = 0;
  let untils = 0;
  for (const m of code.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const w = m[0];
    if (OPENERS.has(w)) depth++;
    else if (w === 'end') depth--;
    else if (w === 'repeat') repeats++;
    else if (w === 'until') untils++;
  }
  // `repeat … until` blocks have no `end`, so they never touch depth.
  if (depth > 0) {
    out.push({
      code: 'LUA_BLOCK_IMBALANCE',
      message:
        `${depth} block(s) opened by function/if/do are never closed — ${depth} more 'end' expected. ` +
        `(Heuristic: strings and comments are excluded, but this is not a parser.)`,
    });
  } else if (depth < 0) {
    out.push({
      code: 'LUA_BLOCK_IMBALANCE',
      message:
        `${-depth} more 'end' than blocks opened by function/if/do. ` +
        `(Heuristic: strings and comments are excluded, but this is not a parser.)`,
    });
  }
  if (repeats !== untils) {
    out.push({
      code: 'LUA_REPEAT_IMBALANCE',
      message: `${repeats} 'repeat' against ${untils} 'until'.`,
    });
  }

  return out;
}

/** One-line summary for a tool response, or undefined when clean. */
export function luaWarningSummary(warnings: LuaWarning[]): string | undefined {
  if (warnings.length === 0) return undefined;
  return (
    `${warnings.length} possible Lua problem(s) — NOT blocking, and this checker is a ` +
    `heuristic, not a parser: ` +
    warnings.map(w => (w.line ? `line ${w.line}: ${w.message}` : w.message)).join(' | ')
  );
}

/**
 * Render a JS value as Lua table source.
 *
 * Exists for one job: telling a caller what they should have sent. HC3 stores a
 * scene's `conditions` and `actions` as Lua SOURCE STRINGS inside a JSON
 * string, and a structured value put in either slot is accepted by the REST
 * layer and then killed by HC3's own engine at subscribe time with
 * `attempt to concatenate a table value (field 'conditions')`. Since the
 * structure a caller means is unambiguous, the refusal can carry the exact Lua
 * to send instead of merely naming the mistake.
 *
 * Deliberately NOT used to convert on the caller's behalf. A scene that
 * validates but behaves subtly differently from what was meant is worse than a
 * refusal, and this is a live home automation controller.
 */
export function toLuaSource(value: unknown, indent = ''): string {
  const next = indent + '  ';
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);   // Lua accepts JSON string escapes
  if (Array.isArray(value)) {
    if (value.length === 0) return '{}';
    const items = value.map(v => `${next}${toLuaSource(v, next)}`);
    return `{\n${items.join(',\n')}\n${indent}}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => {
      // A bare identifier key is idiomatic Lua; anything else needs bracketing.
      const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `[${JSON.stringify(k)}]`;
      return `${next}${key} = ${toLuaSource(v, next)}`;
    });
    return `{\n${items.join(',\n')}\n${indent}}`;
  }
  return 'nil';
}
