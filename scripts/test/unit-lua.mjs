#!/usr/bin/env node
// Unit test — the shallow Lua checker.
//
// The bar here is asymmetric on purpose. A missed problem is a warning that
// did not appear; a FALSE problem is noise on a live gateway that teaches
// callers to ignore the field. So most of these checks assert that valid Lua
// produces NOTHING — including the constructs most likely to fool a
// non-parser: `end` inside strings and comments, `elseif`, long strings, and
// apostrophes in comments.
//
//   node scripts/test/unit-lua.mjs

import { luaLint, luaWarningSummary } from '../../out/mcp/lua.js';
import { strict as assert } from 'node:assert';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const clean = src => {
  const w = luaLint(src);
  assert.deepEqual(w, [], `expected no warnings, got: ${JSON.stringify(w)}`);
};

// --- must stay silent on valid Lua ----------------------------------------

check('a plain QuickApp is clean', () => {
  clean(`
function QuickApp:onInit()
  self.zones = 2
  self:tick()
end

function QuickApp:tick()
  fibaro.setTimeout(60000, function() self:tick() end)
end
`);
});

check('elseif does not open a block', () => {
  clean(`
if a then
  x = 1
elseif b then
  x = 2
elseif c then
  x = 3
else
  x = 4
end
`);
});

check('for/while do...end balances', () => {
  clean(`
for i = 1, 10 do
  while cond do
    doThing()
  end
end
`);
});

check('repeat/until balances and needs no end', () => {
  clean('repeat\n  x = x + 1\nuntil x > 10\n');
});

check('the word "end" inside a string is not counted', () => {
  clean('local msg = "this sentence has the word end in it"\n');
});

check('the word "end" inside a comment is not counted', () => {
  clean('-- we should end this later\nlocal x = 1\n');
});

check('an apostrophe in a comment does not open a string', () => {
  clean("-- don't let this open a string\nlocal x = 1\n");
});

check('brackets inside strings are not counted', () => {
  clean('local s = "unbalanced ( [ {"\n');
});

check('long strings are skipped wholesale', () => {
  clean('local s = [[ end end ( ( " ]]\nlocal t = 1\n');
});

check('levelled long strings are skipped', () => {
  clean('local s = [==[ contains ]] and end ]==]\nlocal t = 1\n');
});

check('long comments are skipped wholesale', () => {
  clean('--[[ end end ( ( \n still comment ]]\nlocal x = 1\n');
});

check('escaped quotes do not end a string early', () => {
  clean('local s = "he said \\"end\\" loudly"\n');
});

check('table constructors and nested calls are clean', () => {
  clean('local t = { a = {1, 2, 3}, b = f(g(h(1))) }\n');
});

check('empty and whitespace-only input is clean', () => {
  clean('');
  clean('   \n\n  ');
});

// --- must catch real damage ------------------------------------------------

check('a missing end is reported', () => {
  const w = luaLint('function QuickApp:onInit()\n  self.x = 1\n');
  assert.equal(w.length, 1);
  assert.equal(w[0].code, 'LUA_BLOCK_IMBALANCE');
  assert.match(w[0].message, /1 block\(s\)/);
});

check('a surplus end is reported', () => {
  const w = luaLint('function f()\nend\nend\n');
  assert.equal(w[0].code, 'LUA_BLOCK_IMBALANCE');
  assert.match(w[0].message, /1 more 'end'/);
});

check('an unclosed bracket is reported with its line', () => {
  const w = luaLint('local t = {\n  a = 1,\n');
  const b = w.find(x => x.code === 'LUA_UNBALANCED_BRACKET');
  assert.ok(b, 'expected a bracket warning');
  assert.equal(b.line, 1);
});

check('a mismatched closer is reported', () => {
  const w = luaLint('local t = (1, 2]\n');
  const b = w.find(x => x.code === 'LUA_UNBALANCED_BRACKET');
  assert.ok(b);
  assert.match(b.message, /does not match/);
});

check('a closer with nothing open is reported', () => {
  const w = luaLint('local x = 1)\n');
  assert.ok(w.some(x => x.code === 'LUA_UNBALANCED_BRACKET'));
});

check('an unterminated string is reported on its own line', () => {
  const w = luaLint('local a = 1\nlocal s = "oops\nlocal b = 2\n');
  const s = w.find(x => x.code === 'LUA_UNTERMINATED_STRING');
  assert.ok(s, 'expected an unterminated-string warning');
  assert.equal(s.line, 2);
});

check('an unterminated long string is reported', () => {
  const w = luaLint('local s = [[ never closed\nmore\n');
  assert.ok(w.some(x => x.code === 'LUA_UNTERMINATED_LONG_STRING'));
});

check('an unterminated long comment is reported', () => {
  const w = luaLint('--[[ never closed\nmore\n');
  assert.ok(w.some(x => x.code === 'LUA_UNTERMINATED_LONG_COMMENT'));
});

check('repeat without until is reported', () => {
  const w = luaLint('repeat\n  x = 1\n');
  assert.ok(w.some(x => x.code === 'LUA_REPEAT_IMBALANCE'));
});

// --- the summary -----------------------------------------------------------

check('summary is undefined when clean', () => {
  assert.equal(luaWarningSummary([]), undefined);
});

check('summary says plainly that it is not a parser and not blocking', () => {
  const s = luaWarningSummary(luaLint('function f()\n'));
  assert.match(s, /NOT blocking/);
  assert.match(s, /heuristic, not a parser/);
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll lua checks passed');
process.exit(failures ? 1 : 0);
