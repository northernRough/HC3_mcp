#!/usr/bin/env node
// Probe — does GET /api/iosDevices/{id} return ONE record, or the whole list?
//
// Reported 13 Aug: it returns the entire collection, identical to the bare
// list endpoint, with the id segment ignored. That shape is worse than a 404
// because it looks like it worked. Anything that takes the first element of
// the response gets a different device than it asked for, every caller writing
// `devices[0]` is wrong and looks right, and no error is ever raised.
//
// It matters here because `get_ios_devices` is the tool that would supply
// device ids to a push-sending tool this server does not yet have — and the
// push finding says the two push mechanisms take DIFFERENT id kinds (user ids
// for fibaro.alert, iOS device ids for /mobile/push) and fail silently on the
// wrong one. Building that tool on a per-id read that lies would stack one
// silent failure on another.
//
// READ-ONLY. Both requests are GETs. The report also names
// DELETE /iosDevices/{id}?udid={udid} as the only shape that passes
// validation; that is NOT probed here, because it would deregister one of the
// household's real phones.
//
//   node scripts/probe-ios-device-by-id.mjs

import { client } from './probe.mjs';

const hc3 = await client();

const list = await hc3.request('/api/iosDevices');
const devices = Array.isArray(list) ? list : (list?.mobileDevices ?? []);
if (!Array.isArray(devices) || devices.length === 0) {
  console.error('No iOS devices registered on this gateway; nothing to probe.');
  process.exit(1);
}
// Not the first entry: if the id segment IS honoured, asking for the first
// one would return a response identical to the list's head and the two
// hypotheses would be hard to tell apart.
const target = devices[devices.length > 1 ? 1 : 0];
const id = target.id;

console.log(`\nGET /api/iosDevices/{id}, ${devices.length} device(s) registered, asking for id ${id}\n`);

const one = await hc3.request(`/api/iosDevices/${id}`);
const returned = Array.isArray(one) ? one : (one?.mobileDevices ?? null);

const listJson = JSON.stringify(list);
const oneJson = JSON.stringify(one);

console.log(`  bare list   : ${Array.isArray(devices) ? devices.length : '?'} entries, ${listJson.length} bytes`);
console.log(`  per-id read : ${Array.isArray(returned) ? returned.length + ' entries' : 'not an array'}, ${oneJson.length} bytes`);

console.log('\nVERDICT');
if (oneJson === listJson) {
  console.log(`  CONFIRMS the report. The per-id read returned the ENTIRE collection,`);
  console.log(`  byte-identical to the bare list. The id segment is ignored.`);
  console.log(`  → Any caller taking the first element gets device ${devices[0].id}, not ${id}.`);
  console.log(`  → get_ios_devices must filter client-side and must never be built on this path.`);
} else if (!Array.isArray(returned) && one && one.id === id) {
  console.log(`  REFUTES the report on this firmware: the per-id read returned the single`);
  console.log(`  record for ${id}. Leave the row in the ledger marked refuted, with this run.`);
} else if (Array.isArray(returned) && returned.length === 1 && returned[0]?.id === id) {
  console.log(`  REFUTES it, in a third shape: a one-element ARRAY holding ${id}.`);
  console.log(`  Callers must still not assume a bare object.`);
} else {
  console.log('  NEITHER. The response matches no expected shape — record it verbatim:');
  console.log('  ' + oneJson.slice(0, 300));
}
console.log();
