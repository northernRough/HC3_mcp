// Tier 3 of firmware-check: does HC3 still lie about writes in the ways we
// have documented?
//
// Every entry corresponds to a row in the silent-write catalogue
// (get_hc3_api_notes topic "silent_writes"). Each records what the catalogue
// SAYS and what the gateway DID, so a firmware that quietly fixes one shows up
// as good news rather than as an unexplained difference. That direction
// matters: a read-only check can never see a write behaviour improve.
//
// Everything runs against a throwaway QuickApp deleted in `finally`, and one
// global variable name that is never created. Nothing here touches a live
// object.

import { withQuickApp, client, sleep } from './probe.mjs';

/** One-element view, enough to make HC3 generate a uiCallbacks entry. */
function viewLayout() {
  return {
    $jason: {
      body: {
        header: { style: { height: '0' }, title: 'fwcheck' },
        sections: {
          items: [{
            type: 'vertical', style: { weight: '1' }, components: [{
              type: 'horizontal', style: { weight: '1' }, components: [
                { name: 'fwBtn', type: 'button', text: 'fwBtn', visible: true, style: { weight: '1.2' } },
              ],
            }],
          }],
        },
      },
    },
  };
}

const NAMED = [{ name: 'fwBtn', eventType: 'onReleased', callback: 'fwHandler' }];

export async function probeWriteBehaviour() {
  const out = [];
  const record = (name, documented, observed, matchesDocumented, note) =>
    out.push({ name, documented, observed, matchesDocumented, note: note ?? null });

  const hc3 = await client();

  // --- 1. A global that does not exist -------------------------------
  // Catalogue: fibaro.setGlobalVariable writes an EXISTING global fine and
  // silently does nothing for one that does not exist. The Lua function needs
  // a scene to exercise; the REST layer beneath it is testable directly and is
  // what this server calls, so that is what is measured — labelled precisely
  // rather than claimed as the Lua behaviour.
  const ghost = `FWCHECK_NEVER_CREATED_${Date.now().toString(36)}`;
  try {
    await hc3.request(`/api/globalVariables/${ghost}`, 'PUT', { name: ghost, value: 'x' });
    const after = await hc3.request(`/api/globalVariables/${ghost}`).catch(() => null);
    record('PUT /globalVariables/{missing}', 'rejected or ineffective — the variable must exist first',
      after ? 'ACCEPTED AND CREATED the variable' : 'accepted, variable still absent',
      !after, after ? 'This would be a behaviour change worth adopting.' : null);
  } catch (err) {
    const st = /HTTP (\d{3})/.exec(String(err.message))?.[1];
    record('PUT /globalVariables/{missing}', 'rejected or ineffective — the variable must exist first',
      `refused with HTTP ${st}`, true, 'Refusing outright is the clearest form of the documented behaviour.');
  }

  // Each probe below gets its OWN throwaway QuickApp. The first version of
  // this file shared one, and the icon probes then contaminated each other:
  // step 4 wrote properties.icon, so step 5's "is properties.icon empty?"
  // measured step 4 rather than the firmware. Two variables at once, in the
  // very file meant to enforce one.

  // --- 2. uiCallbacks supplied AT CREATION are discarded and rewritten.
  // Must go through create_quickapp with initialView: HC3 regenerates the
  // table at creation, and an external viewLayout PUT afterwards is a
  // different code path that leaves uiCallbacks empty.
  await withQuickApp(async (id) => {
    await sleep(2000);
    const d = await hc3.request(`/api/devices/${id}`);
    const generated = d?.properties?.uiCallbacks ?? [];
    const isGenerated = generated.some(c => /^ui.*On[A-Z]/.test(String(c.callback ?? '')));
    const kept = generated.some(c => c.callback === 'fwHandler');
    record('create_quickapp → uiCallbacks',
      'a supplied uiCallbacks is discarded and regenerated as ui<Element>On<Event>',
      kept ? 'KEPT the supplied name'
           : isGenerated ? `regenerated: ${generated.map(c => c.callback).join(', ')}`
           : `neither: ${JSON.stringify(generated).slice(0, 80)}`,
      isGenerated && !kept,
      kept ? 'HC3 now honours callbacks supplied at creation — the follow-up write would be unnecessary.' : null);
  }, { initialView: viewLayout(), initialProperties: { uiCallbacks: NAMED } });

  // --- 3. A named uiCallbacks array written AFTER creation sticks.
  await withQuickApp(async (id) => {
    await hc3.request(`/api/devices/${id}`, 'PUT', { properties: { uiCallbacks: NAMED } });
    await sleep(2000);
    const after = (await hc3.request(`/api/devices/${id}`))?.properties?.uiCallbacks ?? [];
    const stuck = after.some(c => c.callback === 'fwHandler');
    record('modify_device → named uiCallbacks', 'the named array sticks when written after creation',
      stuck ? 'stuck' : `overwritten: ${JSON.stringify(after).slice(0, 80)}`, stuck);
  }, { initialView: viewLayout() });

  // --- 4. An external write of properties.icon.
  // NOTE the limit of this arm: a throwaway QA has no Lua and never starts,
  // while the field report that produced this claim involved a RUNNING QA
  // that restarted on each write. So this measures the REST layer alone.
  await withQuickApp(async (id) => {
    const iconPath = { path: '/assets/userIcons/devices/User1/User1.svg', source: 'HC' };
    await hc3.request(`/api/devices/${id}`, 'PUT', { properties: { icon: iconPath } }).catch(() => {});
    await sleep(2000);
    const iconAfter = (await hc3.request(`/api/devices/${id}`))?.properties?.icon ?? {};
    const discarded = !iconAfter?.path;
    record('external PUT properties.icon (idle QA)',
      'reported discarded on a running QA; this arm covers the REST layer on an idle one',
      discarded ? 'discarded, icon still empty' : `persisted: ${JSON.stringify(iconAfter).slice(0, 60)}`,
      null,
      'Verdict deliberately null: idle-QA persistence does not contradict a running-QA report. '
      + 'Isolating that needs a QA with an onInit, which this tier does not build.');
  });

  // --- 5. deviceIcon set alone, on an untouched QA.
  await withQuickApp(async (id) => {
    await hc3.request(`/api/devices/${id}`, 'PUT', { properties: { deviceIcon: 1 } }).catch(() => {});
    await sleep(2000);
    const d = await hc3.request(`/api/devices/${id}`);
    const iconStillEmpty = !d?.properties?.icon?.path;
    record('deviceIcon alone', 'sets deviceIcon but leaves properties.icon empty, so the tile renders blank',
      iconStillEmpty ? 'properties.icon still empty' : 'properties.icon now populated', iconStillEmpty,
      iconStillEmpty ? null
        : 'HC3 now derives the icon path from deviceIcon — the documented blank-tile trap would be gone.');
  });

  return out;
}
