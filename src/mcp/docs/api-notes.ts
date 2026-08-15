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
A \`modify_device\` PUT of \`properties.parameters\` **caches the value without
transmitting it to the node**. Verified against a Zooz ZEN52. This is the
nastiest entry in the list, because the read-back returns your value: the device
record agrees with you and the physical device never heard about it. Use
\`set_device_parameter\`, which POSTs \`/devices/{id}/action/setConfiguration\` and
does transmit. (\`setParameter\`, \`reconfigure\` and
\`pollConfigurationParameter\` all return \`-3 not implemented\`.)

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
\`properties.icon\`. And an external \`api.put\` of \`properties.icon\` is accepted
and **silently discarded** — that one has to be written from inside the owning
QuickApp with \`self:updateProperty\`.

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
