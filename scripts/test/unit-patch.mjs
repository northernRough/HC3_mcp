#!/usr/bin/env node
// Unit test — patch engine and patch_quickapp_file. No live HC3: the pure
// functions are exercised directly, and the handler runs against a fake client
// that records every request so the "nothing was written" claims can be proved
// rather than asserted.
//
//   node scripts/test/unit-patch.mjs

import { applyEdits, unifiedDiff, countOccurrences } from '../../out/mcp/patch.js';
import { quickapps } from '../../out/mcp/tools/quickapps.js';
import { strict as assert } from 'node:assert';

const patchFile = quickapps.handlers.patch_quickapp_file;

const FILE = [
  'function QuickApp:onInit()',
  '  self.zones = 2',
  '  self:debug("starting")',
  '  self:tick()',
  'end',
  '',
  'function QuickApp:tick()',
  '  self:debug("tick")',
  '  fibaro.setTimeout(60000, function() self:tick() end)',
  'end',
].join('\n');

function fakeHc3(content = FILE, opts = {}) {
  const calls = [];
  let stored = content;
  return {
    calls,
    get stored() { return stored; },
    async request(endpoint, method = 'GET', body) {
      calls.push({ endpoint, method, body });
      if (method === 'PUT') {
        // opts.corrupt models HC3's known silent-write paths.
        stored = opts.corrupt ? String(body.content).slice(0, 10) : body.content;
        return { name: 'main', content: stored };
      }
      if (opts.noContent) return { name: 'main' };
      return { name: 'main', isMain: true, isOpen: false, content: stored };
    },
  };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// --- countOccurrences ------------------------------------------------------

await check('countOccurrences counts non-overlapping matches', () => {
  assert.equal(countOccurrences('aaaa', 'aa'), 2);
  assert.equal(countOccurrences('abcabc', 'abc'), 2);
  assert.equal(countOccurrences('abc', 'zz'), 0);
  assert.equal(countOccurrences('abc', ''), 0);
});

// --- applyEdits: the must-match contract -----------------------------------

await check('a single matching edit is applied', () => {
  const r = applyEdits(FILE, [{ old: 'self.zones = 2', new: 'self.zones = 4' }]);
  assert.ok(r.content.includes('self.zones = 4'));
  assert.ok(!r.content.includes('self.zones = 2'));
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].occurrences, 1);
});

await check('zero matches aborts and says nothing was written', () => {
  assert.throws(
    () => applyEdits(FILE, [{ old: 'self.zones = 99', new: 'x' }]),
    /not found[\s\S]*Nothing was written/
  );
});

await check('zero matches names whitespace when that is the only difference', () => {
  assert.throws(
    () => applyEdits(FILE, [{ old: 'self.zones     =  2', new: 'self.zones = 4' }]),
    /whitespace-insensitive search DOES find it/
  );
});

await check('a stale copy is reported as stale, not as whitespace', () => {
  assert.throws(
    () => applyEdits(FILE, [{ old: 'self.pumpRelay = 17', new: 'self.pumpRelay = 18' }]),
    /your copy may be stale/
  );
});

// 'end' appears three times: twice as a block terminator and once inside the
// setTimeout closure — exactly the ambiguity this refusal exists to catch.
await check('too many matches aborts and suggests the exact count', () => {
  assert.throws(
    () => applyEdits(FILE, [{ old: 'end', new: 'END' }]),
    /Found 3, expected 1[\s\S]*Set count=3/
  );
});

await check('an explicit count replaces every occurrence', () => {
  const r = applyEdits(FILE, [{ old: 'end', new: 'END', count: 3 }]);
  assert.equal(countOccurrences(r.content, 'END'), 3);
  assert.equal(r.applied[0].occurrences, 3);
});

await check('a count that is right for one place but not the file still aborts', () => {
  assert.throws(
    () => applyEdits(FILE, [{ old: 'end', new: 'END', count: 2 }]),
    /Found 3, expected 2/
  );
});

await check('too few matches for the requested count aborts', () => {
  assert.throws(
    () => applyEdits(FILE, [{ old: 'self:tick()', new: 'x', count: 9 }]),
    /Found \d+, expected 9/
  );
});

await check('an empty old is refused', () => {
  assert.throws(() => applyEdits(FILE, [{ old: '', new: 'x' }]), /missing or empty 'old'/);
});

await check('a non-string new is refused', () => {
  assert.throws(() => applyEdits(FILE, [{ old: 'end', new: undefined }]), /non-string 'new'/);
});

await check('identical old and new is refused as a no-op', () => {
  assert.throws(() => applyEdits(FILE, [{ old: 'end', new: 'end' }]), /identical 'old' and 'new'/);
});

await check('a non-integer count is refused', () => {
  assert.throws(() => applyEdits(FILE, [{ old: 'end', new: 'x', count: 1.5 }]), /positive integer/);
  assert.throws(() => applyEdits(FILE, [{ old: 'end', new: 'x', count: 0 }]), /positive integer/);
});

await check('an empty edit list is refused', () => {
  assert.throws(() => applyEdits(FILE, []), /non-empty array/);
});

await check('edits apply in order, each against the previous result', () => {
  const r = applyEdits(FILE, [
    { old: 'self.zones = 2', new: 'self.zones = 4' },
    { old: 'self.zones = 4', new: 'self.zones = 6' },
  ]);
  assert.ok(r.content.includes('self.zones = 6'));
  assert.equal(r.applied.length, 2);
});

await check('a later failing edit discards the earlier ones', () => {
  assert.throws(
    () => applyEdits(FILE, [
      { old: 'self.zones = 2', new: 'self.zones = 4' },
      { old: 'nowhere in this file', new: 'x' },
    ]),
    /including any earlier edits in this patch/
  );
});

await check('deletion via an empty new', () => {
  const r = applyEdits(FILE, [{ old: '  self:debug("starting")\n', new: '' }]);
  assert.ok(!r.content.includes('starting'));
});

await check('replacement text is literal — $& is not expanded', () => {
  const r = applyEdits('local a = 1', [{ old: 'a = 1', new: 'a = "$&$1"' }]);
  assert.equal(r.content, 'local a = "$&$1"');
});

await check('a patch that changes nothing overall is refused', () => {
  assert.throws(
    () => applyEdits(FILE, [
      { old: 'self.zones = 2', new: 'self.zones = 4' },
      { old: 'self.zones = 4', new: 'self.zones = 2' },
    ]),
    /identical to the original/
  );
});

// --- unifiedDiff -----------------------------------------------------------

await check('identical input yields an empty diff', () => {
  assert.equal(unifiedDiff(FILE, FILE), '');
});

await check('diff shows the changed line with - and +', () => {
  const after = FILE.replace('self.zones = 2', 'self.zones = 4');
  const d = unifiedDiff(FILE, after);
  assert.ok(d.includes('@@ '), 'expected a hunk header');
  assert.ok(d.includes('-  self.zones = 2'));
  assert.ok(d.includes('+  self.zones = 4'));
});

await check('a one-line change in a large file yields a small diff', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `  local line${i} = ${i}`).join('\n');
  const after = big.replace('local line2500 = 2500', 'local line2500 = 9999');
  const d = unifiedDiff(big, after);
  const lines = d.split('\n').length;
  assert.ok(lines <= 12, `expected a compact diff, got ${lines} lines`);
  assert.ok(d.includes('+  local line2500 = 9999'));
});

await check('maxLines truncates rather than returning a huge diff', () => {
  const a = Array.from({ length: 500 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 500 }, (_, i) => `b${i}`).join('\n');
  const d = unifiedDiff(a, b, { maxLines: 40 });
  assert.ok(d.includes('diff truncated'), 'expected a truncation notice');
});

await check('diff labels are used in the header', () => {
  const after = FILE.replace('self.zones = 2', 'self.zones = 4');
  const d = unifiedDiff(FILE, after, { fromLabel: 'X', toLabel: 'Y' });
  assert.ok(d.startsWith('--- X\n+++ Y\n'));
});

// --- patch_quickapp_file handler ------------------------------------------

await check('happy path: reads, writes once, verifies, returns a diff', async () => {
  const hc3 = fakeHc3();
  const r = await patchFile(hc3, {
    deviceId: 4933,
    fileName: 'main',
    edits: [{ old: 'self.zones = 2', new: 'self.zones = 4' }],
  });
  const methods = hc3.calls.map(c => c.method);
  assert.deepEqual(methods, ['GET', 'PUT', 'GET'], 'expected read, single write, verify');
  assert.equal(hc3.calls[0].endpoint, '/api/quickApp/4933/files/main');
  assert.equal(r.written, true);
  assert.equal(r.editsApplied, 1);
  assert.equal(r.occurrencesReplaced, 1);
  assert.equal(r.bytesBefore, FILE.length);
  assert.ok(r.diff.includes('+  self.zones = 4'));
  assert.ok(/^[0-9a-f]{32}$/.test(r.hashAfter));
  assert.notEqual(r.hashBefore, r.hashAfter);
  assert.ok(hc3.stored.includes('self.zones = 4'));
});

// The whole point of the tool is that neither the request nor the response
// carries the file. The diff carries a few lines of context by design; what
// must not come back is the rest of the file.
await check('the response carries the change, not the file', async () => {
  // Sized like the real thing: a 58 KB engine where one line changes. The
  // response must stay flat as the file grows — that is the whole feature.
  const big = Array.from({ length: 2000 }, (_, i) => `  local line${i} = ${i}`).join('\n');
  const hc3 = fakeHc3(big);
  const r = await patchFile(hc3, {
    deviceId: 4933,
    fileName: 'watering',
    edits: [{ old: 'local line1000 = 1000', new: 'local line1000 = 9999' }],
  });
  const serialised = JSON.stringify(r);
  assert.ok(!Object.values(r).includes(big), 'no field may hold the whole body');
  assert.ok(!serialised.includes('line1900'), 'code away from the edit must not come back');
  assert.ok(
    serialised.length < big.length / 20,
    `response (${serialised.length}B) should be a small fraction of the file (${big.length}B)`
  );
});

await check('dryRun computes the diff and writes nothing', async () => {
  const hc3 = fakeHc3();
  const r = await patchFile(hc3, {
    deviceId: 4933,
    fileName: 'main',
    edits: [{ old: 'self.zones = 2', new: 'self.zones = 4' }],
    dryRun: true,
  });
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET'], 'dryRun must not PUT');
  assert.equal(r.dryRun, true);
  assert.equal(r.written, false);
  assert.ok(r.diff.includes('+  self.zones = 4'));
  assert.ok(r.hashWouldBe && r.hashWouldBe !== r.hashBefore);
  assert.equal(hc3.stored, FILE, 'file must be untouched');
});

await check('a refused edit issues no PUT at all', async () => {
  const hc3 = fakeHc3();
  await assert.rejects(
    () => patchFile(hc3, {
      deviceId: 4933,
      fileName: 'main',
      edits: [{ old: 'not in the file', new: 'x' }],
    }),
    /patch_quickapp_file refused edit 1 of 1/
  );
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET'], 'a refusal must not write');
  assert.equal(hc3.stored, FILE);
});

await check('a partially-valid patch writes nothing', async () => {
  const hc3 = fakeHc3();
  await assert.rejects(
    () => patchFile(hc3, {
      deviceId: 4933,
      fileName: 'main',
      edits: [
        { old: 'self.zones = 2', new: 'self.zones = 4' },
        { old: 'not in the file', new: 'x' },
      ],
    }),
    /refused edit 2 of 2/
  );
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET']);
  assert.equal(hc3.stored, FILE, 'the first edit must not have leaked through');
});

await check('a silently altered write is caught by the post-write verify', async () => {
  const hc3 = fakeHc3(FILE, { corrupt: true });
  await assert.rejects(
    () => patchFile(hc3, {
      deviceId: 4933,
      fileName: 'main',
      edits: [{ old: 'self.zones = 2', new: 'self.zones = 4' }],
    }),
    /content mismatch after PUT/
  );
});

await check('a file with no string content is rejected before any edit', async () => {
  const hc3 = fakeHc3(FILE, { noContent: true });
  await assert.rejects(
    () => patchFile(hc3, { deviceId: 4933, fileName: 'nope', edits: [{ old: 'a', new: 'b' }] }),
    /returned no string content/
  );
  assert.deepEqual(hc3.calls.map(c => c.method), ['GET']);
});

await check('bad deviceId / fileName are rejected without a request', async () => {
  const hc3 = fakeHc3();
  await assert.rejects(
    () => patchFile(hc3, { deviceId: '4933', fileName: 'main', edits: [{ old: 'a', new: 'b' }] }),
    /numeric deviceId/
  );
  await assert.rejects(
    () => patchFile(hc3, { deviceId: 4933, fileName: '', edits: [{ old: 'a', new: 'b' }] }),
    /requires a fileName/
  );
  assert.equal(hc3.calls.length, 0);
});

await check('the file name is URL-encoded in the path', async () => {
  const hc3 = fakeHc3();
  await patchFile(hc3, {
    deviceId: 7,
    fileName: 'my file',
    edits: [{ old: 'self.zones = 2', new: 'self.zones = 4' }],
  });
  assert.equal(hc3.calls[0].endpoint, '/api/quickApp/7/files/my%20file');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll patch checks passed');
process.exit(failures ? 1 : 0);
