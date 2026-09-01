#!/usr/bin/env node
// Unit test — a 404 has to say WHAT was not found.
//
// 51 of the 83 failures in this project's friction log were the literal
// string "HTTP 404: Not Found", from get_device_property (29) and
// get_device_parameters (22), spread over seventeen days. HC3 sends no body
// on a 404 and `recordFailure` stores only the tool and the message, so the
// largest cluster in the telemetry named neither the device nor the property
// and could not be diagnosed at all.
//
// Fixing that meant putting the request in the message, which is the reason
// for the second half of this file: callers used to recognise "gone" by
// testing the message for /404/, and an id like 4046 CONTAINS "404".
//
//   node scripts/test/unit-not-found.mjs

import { HC3HttpError, isNotFound } from '../../out/mcp/hc3-client.js';
import { devices } from '../../out/mcp/tools/devices.js';
import { zwave } from '../../out/mcp/tools/zwave.js';
import { scenes } from '../../out/mcp/tools/scenes.js';
import { strict as assert } from 'node:assert';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

const notFound = (method, endpoint) => new HC3HttpError(404, 'Not Found', method, endpoint, '');

// ---------------------------------------------------------------------------
// The error itself
// ---------------------------------------------------------------------------

await check('the message names the method and the path', () => {
  const e = notFound('GET', '/api/devices/9999/properties/value');
  assert.match(e.message, /HTTP 404: Not Found \(GET \/api\/devices\/9999\/properties\/value\)/);
});

await check('HC3\'s body still lands after the request context', () => {
  const e = new HC3HttpError(400, 'Bad Request', 'POST', '/api/scenes', '{"reason":"SceneValidationError"}');
  // Callers and tests key off the "HTTP 400" prefix; it has to stay leading.
  assert.ok(e.message.startsWith('HTTP 400: Bad Request '), e.message);
  assert.match(e.message, /\(POST \/api\/scenes\) - \{"reason":"SceneValidationError"\}$/);
});

await check('isNotFound reads the status, not the digits in the path', () => {
  assert.equal(isNotFound(notFound('GET', '/api/devices/12')), true);
  // The regression the status field exists to prevent: 4046 contains "404".
  assert.equal(isNotFound(new HC3HttpError(500, 'Internal Server Error', 'GET', '/api/devices/4046', '')), false);
  assert.equal(isNotFound(new HC3HttpError(403, 'Forbidden', 'PUT', '/api/devices/1404', '')), false);
});

await check('isNotFound still recognises this server\'s own prose', () => {
  // Tool guards raise "not found" without ever reaching the gateway.
  assert.equal(isNotFound(new Error('delete_profile: profile 7 not found.')), true);
  assert.equal(isNotFound(new Error('something else entirely')), false);
});

// ---------------------------------------------------------------------------
// The two tools that produced the cluster
// ---------------------------------------------------------------------------

const fakeHc3 = (routes) => ({
  async request(endpoint, method = 'GET') {
    const hit = routes[endpoint];
    if (hit === undefined) throw notFound(method, endpoint);
    if (hit instanceof Error) throw hit;
    return hit;
  },
});

await check('get_device_parameters names the missing device instead of "HTTP 404"', async () => {
  const err = await zwave.handlers.get_device_parameters(fakeHc3({}), { deviceId: 9999 })
    .then(() => null, e => e);
  assert.ok(err, 'expected a throw');
  assert.match(err.message, /^get_device_parameters: no device 9999 on this HC3\./);
  assert.doesNotMatch(err.message, /HTTP 404/);
});

await check('get_device_property distinguishes a missing device from a missing property', async () => {
  const missingDevice = await devices.handlers.get_device_property(fakeHc3({}), { deviceId: 9999, propertyName: 'value' })
    .then(() => null, e => e);
  assert.match(missingDevice.message, /^get_device_property: no device 9999 on this HC3\./);

  const missingProp = await devices.handlers.get_device_property(
    fakeHc3({ '/api/devices/4742': { id: 4742, name: 'roomManager', properties: { value: 1, batteryLevel: 90, dead: false } } }),
    { deviceId: 4742, propertyName: 'lastBreached' },
  ).then(() => null, e => e);
  assert.match(missingProp.message, /device 4742 \(roomManager\) has no property 'lastBreached'/);
  // The list is the point: it turns a dead end into the next call.
  assert.match(missingProp.message, /It exposes 3: batteryLevel, dead, value\./);
});

await check('a property that exists is still returned untouched', async () => {
  const hc3 = fakeHc3({ '/api/devices/4742/properties/value': { value: 42, modified: 1 } });
  assert.deepEqual(await devices.handlers.get_device_property(hc3, { deviceId: 4742, propertyName: 'value' }), { value: 42, modified: 1 });
});

await check('a non-404 failure is propagated, not reinterpreted', async () => {
  const boom = new HC3HttpError(500, 'Internal Server Error', 'GET', '/api/devices/4742/properties/value', '');
  const hc3 = fakeHc3({ '/api/devices/4742/properties/value': boom });
  const err = await devices.handlers.get_device_property(hc3, { deviceId: 4742, propertyName: 'value' }).then(() => null, e => e);
  assert.equal(err, boom);
});

// ---------------------------------------------------------------------------
// The post-delete verifies, which used to route their own sentinel through
// the catch that swallowed 404s
// ---------------------------------------------------------------------------

await check('delete_scene reports a scene that survived the DELETE', async () => {
  // Id chosen deliberately: "4046" contains "404". Under the old check, the
  // "still exists" sentinel matched /404/ through the scene id and was
  // swallowed, so a failed delete returned success.
  const scene = { id: 4046, name: 'stubborn', type: 'lua', roomId: 219, content: '' };
  const hc3 = { async request() { return scene; } };
  const err = await scenes.handlers.delete_scene(hc3, { sceneId: 4046 }).then(() => null, e => e);
  assert.ok(err, 'expected delete_scene to report the scene still exists');
  assert.match(err.message, /post-delete verify failed — scene 4046 still exists/);
});

await check('delete_scene still succeeds when the scene really is gone', async () => {
  const scene = { id: 4046, name: 'gone', type: 'lua', roomId: 219, content: '' };
  let deleted = false;
  const hc3 = {
    async request(endpoint, method = 'GET') {
      if (method === 'DELETE') { deleted = true; return null; }
      if (deleted) throw notFound('GET', endpoint);
      return scene;
    },
  };
  const res = await scenes.handlers.delete_scene(hc3, { sceneId: 4046 });
  assert.equal(res.sceneId, 4046);
  assert.equal(res.deletedScene.name, 'gone');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll not-found checks passed');
process.exit(failures ? 1 : 0);
