// Cross-cutting gateway behaviour: what does not work, and what lies about
// working. Neither topic belongs to the QuickApp or the scenes guide — both are
// about HC3's REST surface as a whole — and both were previously unreachable
// from a client.
//
// `dead_endpoints` is READ FROM KNOWN_DEAD_ENDPOINTS.md at call time rather
// than copied into this file. The file ships in the package (see package.json
// `files`), so there is no second copy to drift. That matters here more than
// the small runtime cost: a duplicated reference that silently falls out of
// date is the exact failure this repo keeps hitting — get_icon's error text
// contradicted upload_icon's description for weeks in the same source file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Package root, from out/mcp/docs/ (compiled) — three levels up. */
function packageRoot(): string {
  return join(__dirname, '..', '..', '..');
}

function deadEndpointsContent(): string {
  try {
    return readFileSync(join(packageRoot(), 'KNOWN_DEAD_ENDPOINTS.md'), 'utf8');
  } catch {
    // Never throw from a doc tool. Say what happened and where to look, rather
    // than returning an empty section that reads like "there are none".
    return [
      '# Known dead endpoints — FILE NOT READABLE',
      '',
      'KNOWN_DEAD_ENDPOINTS.md ships with this package but could not be read',
      'from ' + packageRoot() + '.',
      '',
      'This is a packaging fault, not a statement that no endpoints are dead.',
      'Several documented HC3 endpoints DO return 501/500/404 on 5.2x, and two',
      'return a misleading 200 with the wrong body. Prefer a tool over a',
      'hand-built path until this is readable again, and see the copy in the',
      'repository at https://github.com/northernRough/HC3_mcp',
    ].join('\n');
  }
}

export const apiNotes = {
  overview:
    'Gateway-wide REST behaviour: endpoints that are dead despite being documented, and writes that report success without doing anything. Both cut across tools, so neither lives in the QuickApp or scenes guide.',

  get dead_endpoints() {
    return {
      title: 'Known dead and misleading HC3 REST endpoints',
      content: deadEndpointsContent(),
    };
  },

  silent_writes: {
    title: 'Writes that report success and do nothing — the catalogue',
    content: `
## The rule

**A call that does not throw has not necessarily worked.** HC3 accepts, stores
and reports success for requests it will not act on. This is the single most
expensive behaviour on the platform, because every instinct you have from other
APIs is wrong here: no error is raised, the status is 2xx, and on several of
these a read-back returns exactly what you wrote.

Every entry below was observed on a live gateway.

## The catalogue

### Global variables
\`fibaro.setGlobalVariable\` writes an EXISTING global correctly and **silently
does nothing** for one that does not exist. No error, no creation. A heartbeat
went into a void for a day this way. Create the variable first
(\`create_global_variable\`), or write through this server's
\`set_global_variable\`, which checks.

### Z-Wave configuration parameters
A \`modify_device\` PUT of \`properties.parameters\` **never transmits to the
node**. On older firmware it cached the value (Zooz ZEN52), so the read-back
agreed with you while the device never heard about it. On 5.220.15 it is
ignored outright: 200, nothing stored (14 Nov 2026). \`modify_device\` refuses
it. Use \`set_device_parameter\`, which POSTs
\`/devices/{id}/action/setConfiguration\` and does transmit.

**Proving a write reached the device** (14 Nov 2026, FGRGBW442, node 187).
The node's cumulative radio counters at
\`/api/zwave/nodes/diagnostics/transmissions\` stood still for 30-45 s idle.
A \`setConfiguration\` moved them 2-3 frames out; a parameter poll moved them
1 out / 1 in. \`set_device_parameter\` now returns that delta as \`radio\`, and
\`transmitted\`.

**HC3's parameter cache follows the device.** After a valid write the cache
showed the new value. An out-of-range value (5, where 0 or 30-32400 is
allowed) was transmitted, refused by the device (it did not start reporting
every 5 s), and the cache kept the device's 3600. So a transmitted write whose
cache did not change was either refused by the device, or hit a one-shot
TRIGGER parameter: Qubino Mini Dimmer (ZMNHHD1) parameter 71 = 2 forces a
calibration (watched 14 Nov 2026 on node 72: the lights came on for about 2 s
and went off, dimming normal afterwards) and the parameter reads 0 again.

**Live read-back works.** The device ACTIONS \`setParameter\`, \`reconfigure\`
and \`pollConfigurationParameter\` return \`-3 not implemented\`. The web UI's
route, \`POST /api/zwave/polling/configuration_parameters/{addr}/{number}\`,
answers 202 and sends a Configuration Get to the node, which answers.
\`get_device_parameters\` exposes it as \`refreshFromDevice\`. Not yet seen: a
stale cache being corrected by a poll, because no way to make the cache
stale was found; the cache tracked the device in every test.

**A poll fills a value HC3 never had** (14 Nov 2026). Eight Qubinos showed
their parameters with no \`configurationValue\` at all: HC3 had never read
them. One poll of parameter 40 on node 228 sent one frame, got one back, and
the value (50) appeared. \`set_device_parameter\` also refuses a size that
contradicts the device's template (an FGD212 tolerated 2 bytes for its 1-byte
parameter 50; another device need not). From inside a QuickApp every /zwave/
route answers 501.

**Address.** Parameters belong to the NODE and live at \`{nodeId}.0\`. An
endpoint child's own address (\`187.1\`) answers 404. Before 4.39.0 both
parameter tools used the child's address and came back empty for 307 of 709
parameterised devices on this gateway.

**Who may read /api/zwave/** (15 Nov 2026, 5.220.15). Only the superuser. A
scene or QuickApp gets 501 / "" from \`api.get\` on any /zwave/ route, and a
limited user is refused it over HTTP too (the owner tested scene 82 with one;
whether granting \`advanced.zWave\` changes that was not isolated). So code inside HC3 that
needs Z-Wave diagnostics or parameters either embeds the admin password or
reads them from outside. This gateway does the latter: the Pi's
\`hc3-zwave-feed\` (hc3-snapshot repo, every 5 min) publishes the global
\`ZwTxStats\` (\`{at, items:[per-node radio counters]}\`) and \`ZwParams\`
(\`{at, nodes:{"<node>":[{id,value,size}]}}\`, nodes bound in BinderBindings,
about every 14 min). Scene 82 and deviceBinder 4826 read those and hold no
credentials. HC3 stores a 100 KB global value whole.

**Users** (15 Nov 2026). \`POST /api/users\` needs \`email\` (400
MISSING_PARAMETER without it). The superuser cannot set another user's password:
\`PUT /api/users/{id}\` with \`password\` answers 403 "Only the user can change
the password". **Failed logins lock out the whole client address**: about 12
Basic-auth requests with a bad password made every account, the superuser
included, answer 401 from that host for under 2 minutes. Never test a
credential in a loop; make one request and stop.

### QuickApp view layouts
A \`select\` missing \`selectionType\`, or with \`values\` as a JSON object rather
than an array, is stored, reported verified, and then serves an **EMPTY view** —
the whole tile, every other component gone. \`modify_device\` refuses both known
shapes now. After any view write, read \`get_plugin_view\` back.

### QuickApp UI callbacks
\`create_quickapp\` **discards** a supplied \`uiCallbacks\` array and regenerates
it from the view, rewriting the callback name AND normalising the eventType to
\`onReleased\`. The layout renders, so it looks like it worked. Events then land
on a generated method your QuickApp does not implement and nothing runs at all.

Worse, one level up: a name written back with \`modify_device\` **does** stick and
**does** dispatch under \`call_ui_event\` — and is ignored entirely by a real tap,
which always calls \`UIAction\`. So the write succeeded, the read-back agrees, the
MCP-fired test passes, and the tile is dead under a finger. See
get_hc3_quickapp_programming_guide({topic:"ui"}).

### QuickApp tile icons
Two of them. Setting \`properties.deviceIcon\` on a freshly created QuickApp
verifies as applied and leaves the tile **blank**, because the tile renders from
\`properties.icon\`. An external \`api.put\` of \`properties.icon\` was reported
discarded on a **running** QuickApp — but probed here on an idle throwaway QA
it PERSISTS, so the REST layer is not what drops it. The likely mechanism is
the QuickApp overwriting the property when it starts, and each external write
restarts it. Treat "write it from inside the QA with \`self:updateProperty\`" as
the reliable route, and the discard as conditional on the QA running rather
than as a property of the endpoint.

### Icon uploads
Uploading a single bare image for a device type that holds a state SET (a relay
holds 2, a dimmer 11) registers, attaches, reports no error, and renders blank,
because HC3's lookup asks for \`User<N>0.png\`. \`upload_icon\` refuses the
mismatches it can recognise.

### QuickApp variable writes and restarts
Each external QuickApp-variable write restarts the QA, once per call. A write
issued after another restarting call **may never run**. Create all variables
before any \`api.put\` that also restarts, or use
\`update_multiple_quickapp_files\`, which restarts once for the whole batch.

### A non-numeric value on a numeric property
\`update_device_property\` (and \`self:updateProperty\` inside the QuickApp) writing a
string such as "-" to \`value\` on a \`com.fibaro.multilevelSensor\` is **silently
declined**: no error, a null result exactly as on success, and \`value\` and its
\`modified\` unchanged (16 Aug 2026). A pcall cannot catch it. Read the property
back and compare \`modified\`.

### Neighbour-update results are stamped before the node answers
After \`requestNodeNeighborUpdate\`, HC3 sets \`neighborListResponseTimestamp\` and
resets \`lastWorkingRoute\` (often to [1], "direct") within seconds, **whether or
not the node replied**. A Zniffer capture (24 Oct 2026) showed the HC3 still
working through its queue long after the stamps, and nodes stamped that never
returned Range Info. A read-back of these fields is not evidence the update ran.

### Z-Wave associations read as empty
\`properties.associations\` is \`[]\` on devices included under Z-Wave engine 3
(no \`zwaveMigrated\` interface) **even when an association demonstrably works**
(25 Oct 2026: a motion sensor's group-2 association to a dimmer, proven by event
timing). The same model migrated from the old engine lists it. Treat \`[]\` as
UNKNOWN, not none, before "fixing" an association that is working.

### Device filter: hasNoProperty and property attributes
\`POST /api/devices/filter\` with \`hasNoProperty\` returns **no devices, in any
combination** (13 Nov 2026: 0 returned, 695 matching); \`hasProperty\` works. And
property attributes (\`{"properties": [...]}\`) are dropped, returning id and name
only. filter_devices evaluates both itself since 4.35.0; anything calling the
endpoint directly gets a confident empty answer.

### Missing assets answer 200
Not a write, but the same family and it breaks the same reasoning: HC3 does not
404 a missing asset. It answers **200 with a placeholder** — a 1888-byte
"unknown icon" SVG under /assets/icon, or its web UI index.html elsewhere. HTTP
status alone never proves an asset exists. Check the content.

## What this server does about it, and where that stops

Every mutating tool here does read-modify-write and then re-fetches and compares
what it submitted, raising on a mismatch rather than reporting success. That
catches a large class: field ignored, field coerced, field written somewhere
else, partial array replacement.

**It cannot catch the case where HC3 stores your value faithfully and simply
never acts on it.** The Z-Wave parameter cache is exactly that, and so is the
uiCallbacks name that dispatches under one path and not the other. For those,
verification has to come from outside the API: read the physical device, or tap
the tile.

That is the practical rule. Read-back proves the record; only the world proves
the effect.

## If you find another

Call \`report_finding\` with a single-variable reproduction. This catalogue is
built entirely from findings, and each one arrived because somebody hit it,
worked around it, and wrote it down rather than moving on.
    `,
  },
};
