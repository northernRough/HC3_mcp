#!/usr/bin/env node
// Probe — is there ANY REST path to a scene's variables?
//
// This decides a roadmap item rather than fixing a bug. "Scene variables beat
// globals" is agreed sound design, and the friction ledger has carried a
// scene-variable tool as an open gap since 13 August. If the claim below
// holds, that gap is UNBUILDABLE rather than unbuilt, and should be struck
// rather than kept on a list as though someone will get to it.
//
// The claim, reported 13 Aug and never verified here: every REST path to
// scene variables returns 501 with an empty body, while fibaro.setSceneVariable
// works fine inside a running scene. Attributed originally to jgab (forum
// topic 79129) and never tested by anybody.
//
// READ-ONLY. Every request is a GET, nothing is created, nothing is written,
// so there is no teardown and no scene is touched. The POST path the original
// report also tried is deliberately NOT repeated here: HC3 has no dry-run and
// a write probe against a live gateway is a real write.
//
// Controls matter more than the arms. A 501 means nothing on its own if this
// gateway answers 501 to every unrouted path, so the run asserts that a
// known-good path returns 200 and a known-nonsense path returns the same
// thing the arms do. Without both, "501" is not evidence.
//
//   node scripts/probe-scene-variables.mjs [sceneId]

import { client } from './probe.mjs';

const hc3 = await client();
const sceneId = Number(process.argv[2] ?? 0);

async function probe(label, path) {
  const url = `http://${hc3.config.host}:${hc3.config.port}${path}`;
  const auth = Buffer.from(`${hc3.config.username}:${hc3.config.password}`).toString('base64');
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  const shown = body.length > 70 ? body.slice(0, 70) + '…' : body;
  console.log(`  ${String(res.status).padEnd(4)} ${label.padEnd(34)} ${path}`);
  console.log(`       body: ${body.length} bytes ${body.length ? JSON.stringify(shown) : '(empty)'}`);
  return { status: res.status, body };
}

// A scene to ask about. Any real one will do; the probe never modifies it.
let target = sceneId;
if (!target) {
  const scenes = await hc3.request('/api/scenes');
  target = scenes?.[0]?.id;
  if (!target) {
    console.error('No scenes on this gateway to probe. Pass a scene id explicitly.');
    process.exit(1);
  }
  console.log(`  [probe] no scene id given; using ${target} (${scenes[0]?.name}) — read-only`);
}

console.log(`\nScene-variable REST paths, scene ${target} (all GET, nothing written)\n`);

console.log('CONTROLS');
const good = await probe('known-good: the scene itself', `/api/scenes/${target}`);
const nonsense = await probe('known-nonsense path', `/api/scenes/${target}/thisIsNotARealSubresource`);

console.log('\nARMS');
const arms = [
  ['collection', `/api/scenes/${target}/variables`],
  ['single, plural noun', `/api/scenes/${target}/variables/probeVar`],
  ['single, singular noun', `/api/scenes/${target}/variable/probeVar`],
  ['sceneVariables spelling', `/api/scenes/${target}/sceneVariables`],
];
const results = [];
for (const [label, path] of arms) results.push(await probe(label, path));

console.log('\nVERDICT');
if (good.status !== 200) {
  console.log('  INCONCLUSIVE — the known-good control did not return 200, so this gateway');
  console.log('  is not answering normally and nothing below can be trusted.');
  process.exit(2);
}
const allSame = results.every(r => r.status === nonsense.status && r.body.length === nonsense.body.length);
const allEmpty501 = results.every(r => r.status === 501 && r.body.length === 0);

if (allSame) {
  console.log(`  Every arm answered exactly as the NONSENSE path did (${nonsense.status}, ${nonsense.body.length} bytes).`);
  console.log('  That is the signature of an unrouted path, not of a feature that exists and');
  console.log('  refuses. CONFIRMS the claim: no REST route reaches scene variables.');
  console.log('  → The scene-variable tool is unbuildable. Strike it from the gaps list.');
} else if (allEmpty501) {
  console.log('  Every arm returned an empty 501, but the nonsense control did NOT match.');
  console.log('  That distinguishes "route exists, not implemented" from "no route", which is');
  console.log('  a materially different answer — record which arms differed.');
} else {
  console.log('  MIXED. At least one arm behaves differently from the others:');
  results.forEach((r, i) => console.log(`    ${arms[i][0]}: ${r.status}, ${r.body.length} bytes`));
  console.log('  REFUTES the blanket claim. Follow the arm that differs.');
}
console.log('\n  Note: this says nothing about fibaro.setSceneVariable, which runs inside the');
console.log('  scene and does not go through REST. Both can be true at once.\n');
