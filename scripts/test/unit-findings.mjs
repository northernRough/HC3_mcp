#!/usr/bin/env node
// Unit test — 4.38.0: create_backup body (finding 1790180016) and
// get_temperature_history (finding 1793488407). Fake clients only.
import { strict as assert } from 'node:assert';
const { backups } = await import('../../out/mcp/tools/backups.js');
const { history } = await import('../../out/mcp/tools/history.js');
let failures = 0;
async function check(name, fn) { try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); } }

await check('create_backup sends the web UI body: action + params', async () => {
  const calls = [];
  await backups.handlers.create_backup({ async request(ep, m, b) { calls.push({ ep, m, b }); return null; } },
    { type: 'remote', description: 'before\n"upgrade"  5.220.19' });
  assert.deepEqual(calls[0], { ep: '/api/service/backups', m: 'POST',
    b: { action: 'create', params: { type: 'remote', description: 'before upgrade 5.220.19', skipHistoryData: false } } });
});

const series = Array.from({ length: 1000 }, (_, i) => [1_794_000_000_000 + i * 60_000, 20 + (i % 10) / 10]);
const fake = (pts) => ({ async request(ep) {
  if (ep === '/api/devices/3704') return { id: 3704, name: 'hall temp' };
  if (ep.startsWith('/api/temperature/')) return pts;
  throw new Error(ep);
} });
await check('epoch ms become seconds; long series thinned keeping first and last', async () => {
  const r = await history.handlers.get_temperature_history(fake(series), { deviceId: 3704, from: 1, to: 2, maxPoints: 100 });
  assert.equal(r.total, 1000); assert.equal(r.returned, 100);
  assert.deepEqual(r.points[0], [1_794_000_000, 20]);
  assert.deepEqual(r.points.at(-1), [1_794_000_000 + 999 * 60, 20.9]);
  assert.equal(r.min, 20); assert.equal(r.max, 20.9);
});
await check('an empty series says why, not that the device is missing', async () => {
  const r = await history.handlers.get_temperature_history(fake([]), { deviceId: 3704 });
  assert.equal(r.total, 0); assert.match(r.note, /saveLogs/);
});
await check('from must precede to', async () => {
  await assert.rejects(history.handlers.get_temperature_history(fake([]), { deviceId: 3704, from: 10, to: 5 }), /must be before/);
});
console.log(failures ? `\n${failures} FAILED` : '\nall passed'); process.exit(failures ? 1 : 0);
