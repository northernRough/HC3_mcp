#!/usr/bin/env node
// Unit test — audit_qa_devices classification, and the branch that was dead.
//
// The lookup catch read:
//
//   if (msg.includes('HTTP 404')) DELETED else DELETED
//
// Two arms doing the same thing, under a comment saying the second meant
// "unknown". So a timeout, a 5xx or an unreachable gateway reported someone's
// live device as DELETED — a report that invites them to rip a working
// binding out of a QuickApp. Not checking is a different answer from checking
// and finding nothing, and only one of them is safe to act on.
//
//   node scripts/test/unit-audit-classify.mjs

import { strict as assert } from 'node:assert';
import { audit } from '../../out/mcp/tools/audit.js';
import { HC3HttpError } from '../../out/mcp/hc3-client.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// A QuickApp whose single file references four ids, one per outcome.
const SOURCE = [
  'local alive   = 1101',
  'local dead    = 1102',
  'local gone    = 1103',
  'local flaky   = 1104',
].join('\n');

function fakeHc3(behaviour) {
  return {
    async request(endpoint) {
      if (/\/api\/devices\/4000$/.test(endpoint)) {
        return { id: 4000, name: 'TestQA', type: 'com.fibaro.genericDevice', interfaces: ['quickApp'] };
      }
      if (endpoint.includes('/files')) {
        return endpoint.endsWith('/files')
          ? [{ name: 'main', isMain: true, isOpen: false }]
          : { name: 'main', isMain: true, content: SOURCE };
      }
      const m = endpoint.match(/\/api\/devices\/(\d+)$/);
      if (m) return behaviour(Number(m[1]));
      return {};
    },
  };
}

const behaviour = id => {
  switch (id) {
    case 1101: return { id, name: 'Alive one', type: 'com.fibaro.binarySwitch', properties: {} };
    case 1102: return { id, name: 'Dead one', type: 'com.fibaro.binarySwitch', properties: { dead: true } };
    case 1103: throw new HC3HttpError(404, 'Not Found', 'GET', `/api/devices/${id}`, '');
    default: throw new HC3HttpError(500, 'Internal Server Error', 'GET', `/api/devices/${id}`, '');
  }
};

const run = () => audit.handlers.audit_qa_devices(fakeHc3(behaviour), { deviceId: 4000 });

await check('a 404 is DELETED and a 5xx is UNKNOWN, not both DELETED', async () => {
  const res = await run();
  const kind = id => res.issues.find(i => i.id === id)?.kind;
  assert.equal(kind(1103), 'DELETED', 'a real 404 must still read as gone');
  assert.equal(kind(1104), 'UNKNOWN', 'a 500 must NOT be reported as deleted');
  assert.equal(kind(1102), 'DEAD');
  assert.equal(kind(1101), undefined, 'healthy ids are not enumerated');
});

await check('the summary counts unknowns separately', async () => {
  const res = await run();
  assert.deepEqual(
    { alive: res.summary.alive, dead: res.summary.dead, deleted: res.summary.deleted, unknown: res.summary.unknown },
    { alive: 1, dead: 1, deleted: 1, unknown: 1 });
});

await check('an unknown carries the underlying error, so it can be diagnosed', async () => {
  const res = await run();
  const issue = res.issues.find(i => i.id === 1104);
  assert.match(issue.error, /HTTP 500/);
  // And it names the request, which is 4.27.0's doing.
  assert.match(issue.error, /GET \/api\/devices\/1104/);
});

await check('a summary warning says unaudited, explicitly not deleted', async () => {
  const res = await run();
  assert.match(res.summary.warning, /could not be checked/);
  assert.match(res.summary.warning, /NOT as deleted/);
});

await check('no warning when everything was actually checked', async () => {
  const clean = id => ({ id, name: 'x', type: 'com.fibaro.binarySwitch', properties: {} });
  const res = await audit.handlers.audit_qa_devices(fakeHc3(clean), { deviceId: 4000 });
  assert.equal(res.summary.unknown, 0);
  assert.equal(res.summary.warning, undefined, 'warned when there was nothing to warn about');
});

await check('UNKNOWN sorts last, because it is not a claim about the device', async () => {
  const res = await run();
  assert.deepEqual(res.issues.map(i => i.kind), ['DEAD', 'DELETED', 'UNKNOWN']);
});

await check('an id containing 404 is classified by status, not by its digits', async () => {
  // The trap the message-scraping version walked into: "4046" contains "404",
  // so a 500 on that device read as gone.
  const src = 'local awkward = 4046';
  const hc3 = {
    async request(endpoint) {
      if (/\/api\/devices\/4000$/.test(endpoint)) {
        return { id: 4000, name: 'TestQA', type: 'com.fibaro.genericDevice', interfaces: ['quickApp'] };
      }
      if (endpoint.endsWith('/files')) return [{ name: 'main', isMain: true, isOpen: false }];
      if (endpoint.includes('/files/')) return { name: 'main', isMain: true, content: src };
      throw new HC3HttpError(500, 'Internal Server Error', 'GET', endpoint, '');
    },
  };
  const res = await audit.handlers.audit_qa_devices(hc3, { deviceId: 4000 });
  assert.equal(res.issues.find(i => i.id === 4046)?.kind, 'UNKNOWN',
    'a 500 on device 4046 was reported as DELETED because the id contains "404"');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll audit-classify checks passed');
process.exit(failures ? 1 : 0);
