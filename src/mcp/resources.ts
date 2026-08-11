// MCP Resources — read-only, at-a-glance views of the gateway.
//
// These answer the questions you ask most often and that no single tool
// answers: is anything broken, is the automation machinery alive, did the
// bindings resolve, what is the automation state right now. A client lists
// them and reads one; there is no tool call to compose and no arguments to
// get right.
//
// Every resource is READ-ONLY and renders Markdown, so the output is
// legible to a person and to an agent without further parsing.
//
// SAFETY: QuickApp variable arrays can hold credentials — deviceBinder 4826
// carries HC3_USER / HC3_PASS next to its binding cache. Resources here read
// named variables individually and never emit a whole quickAppVariables
// array. See redactedVarLookup().

import { HC3Client } from './hc3-client';
import { parseBindBlocks } from './tools/audit';
import { readEntries, groupFailures, frictionPath } from './friction';

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read(hc3: HC3Client): Promise<string>;
}

// --- helpers -----------------------------------------------------------

/** HC3's authoritative now, in epoch seconds. Falls back to host clock. */
async function hc3Now(hc3: HC3Client): Promise<number> {
  try {
    const info: any = await hc3.request('/api/settings/info');
    if (typeof info?.timestamp === 'number') return info.timestamp;
  } catch { /* fall through */ }
  return Math.floor(Date.now() / 1000);
}

function ago(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  const m = seconds / 60;
  if (m < 90) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/**
 * Read one named QuickApp variable. Deliberately returns only the requested
 * variable's value — never the array — so credential-bearing siblings
 * (HC3_USER / HC3_PASS on 4826) cannot leak into a rendered resource.
 */
async function redactedVarLookup(hc3: HC3Client, deviceId: number, varName: string): Promise<string | null> {
  const device: any = await hc3.request(`/api/devices/${deviceId}`);
  const vars: any[] = device?.properties?.quickAppVariables ?? [];
  const hit = vars.find(v => v?.name === varName);
  if (!hit) return null;
  return typeof hit.value === 'string' ? hit.value : JSON.stringify(hit.value);
}

function parseJson(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_none_\n';
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${r.join(' | ')} |`),
  ].join('\n') + '\n';
}

// --- hc3://health ------------------------------------------------------

const health: ResourceDef = {
  uri: 'hc3://health',
  name: 'Gateway health',
  description: 'One screen: firmware, device fleet size, dead/unreachable devices named, battery outliers, and disabled devices. The "is anything broken right now" view.',
  mimeType: 'text/markdown',
  async read(hc3) {
    const [info, devices] = await Promise.all([
      hc3.request('/api/settings/info').catch(() => null) as Promise<any>,
      hc3.request('/api/devices') as Promise<any>,
    ]);
    const all: any[] = Array.isArray(devices) ? devices : [];
    const now = typeof info?.timestamp === 'number' ? info.timestamp : Math.floor(Date.now() / 1000);

    const dead = all.filter(d => d?.properties?.dead === true);
    const batteries = all.filter(d => typeof d?.properties?.batteryLevel === 'number');
    const lowBattery = batteries
      .filter(d => d.properties.batteryLevel < 30)
      .sort((a, b) => a.properties.batteryLevel - b.properties.batteryLevel);
    const disabled = all.filter(d => d?.enabled === false);

    const out: string[] = [];
    out.push('# HC3 gateway health\n');
    out.push(`_Generated ${new Date(now * 1000).toISOString()} from HC3's own clock._\n`);
    out.push('## Gateway\n');
    out.push(table(['Field', 'Value'], [
      ['Firmware', String(info?.softVersion ?? 'unknown')],
      ['Serial', String(info?.serialNumber ?? 'unknown')],
      ['Model', String(info?.hcName ?? info?.platform ?? 'unknown')],
      ['Devices', String(all.length)],
    ]));

    out.push(`\n## Dead / unreachable — ${dead.length}\n`);
    if (dead.length === 0) {
      out.push('Nothing reporting dead. \n');
    } else {
      out.push('These report `properties.dead = true`. A dead Z-Wave node usually means a flat battery, a powered-off actor, or a mesh route that has gone.\n\n');
      out.push(table(['id', 'Name', 'Room', 'Type'], dead
        .sort((a, b) => a.id - b.id)
        .map(d => [String(d.id), String(d.name ?? ''), String(d.roomID ?? ''), String(d.type ?? '')])));
    }

    out.push(`\n## Batteries — ${batteries.length} battery-powered, ${lowBattery.length} below 30%\n`);
    out.push(lowBattery.length === 0
      ? 'No device below 30%.\n'
      : table(['Level', 'id', 'Name'], lowBattery.slice(0, 25)
        .map(d => [`${d.properties.batteryLevel}%`, String(d.id), String(d.name ?? '')])));

    if (disabled.length > 0) {
      out.push(`\n## Disabled — ${disabled.length}\n`);
      out.push(table(['id', 'Name'], disabled.slice(0, 25).map(d => [String(d.id), String(d.name ?? '')])));
    }
    return out.join('');
  },
};

// --- hc3://watchdog ----------------------------------------------------

/**
 * Heartbeats are discovered by name (`*Heartbeat`) rather than hard-coded, so
 * a QuickApp added later shows up here without a code change. Each holds an
 * epoch-second timestamp written by its owning QA.
 */
const STALE_AFTER_S = 600;

const watchdog: ResourceDef = {
  uri: 'hc3://watchdog',
  name: 'Watchdog and heartbeats',
  description: 'Every *Heartbeat global with its age and a fresh/stale verdict, plus matching watchdog push markers. Answers "is the automation machinery alive".',
  mimeType: 'text/markdown',
  async read(hc3) {
    const [globals, now] = await Promise.all([
      hc3.request('/api/globalVariables') as Promise<any>,
      hc3Now(hc3),
    ]);
    const all: any[] = Array.isArray(globals) ? globals : [];
    const beats = all.filter(v => /Heartbeat$/.test(v?.name ?? '')).sort((a, b) => a.name.localeCompare(b.name));
    const pushes = all.filter(v => /WatchdogLastPush$/.test(v?.name ?? '')).sort((a, b) => a.name.localeCompare(b.name));

    const out: string[] = [];
    out.push('# Watchdog and heartbeats\n');
    out.push(`_HC3 time ${new Date(now * 1000).toISOString()}. A heartbeat is called stale after ${STALE_AFTER_S / 60} minutes._\n`);

    let stale = 0;
    const rows = beats.map(v => {
      const epoch = Number(v.value);
      const isEpoch = Number.isFinite(epoch) && epoch > 1_000_000_000;
      const age = isEpoch ? now - epoch : NaN;
      const bad = !isEpoch || age > STALE_AFTER_S;
      if (bad) stale++;
      return [
        v.name.replace(/Heartbeat$/, ''),
        isEpoch ? new Date(epoch * 1000).toISOString().slice(11, 19) : `_not an epoch: ${String(v.value).slice(0, 20)}_`,
        isEpoch ? ago(age) : '—',
        bad ? '**STALE**' : 'fresh',
      ];
    });

    out.push(`\n## Heartbeats — ${beats.length} found, ${stale} stale\n`);
    out.push(rows.length === 0
      ? '_No `*Heartbeat` globals found. If QuickApps here are meant to publish one, that is itself the finding._\n'
      : table(['QuickApp', 'Last beat (UTC)', 'Age', 'Verdict'], rows));

    if (stale > 0) {
      out.push('\nA stale heartbeat means the owning QuickApp has stopped ticking. The watchdog scene should restart it; if the value stays stale, the watchdog is not doing its job either.\n');
    }

    out.push(`\n## Watchdog push markers — ${pushes.length}\n`);
    out.push(table(['Variable', 'Value', 'Last modified'], pushes.map(v => [
      v.name,
      String(v.value).slice(0, 24),
      typeof v.modified === 'number' ? ago(now - v.modified) : 'unknown',
    ])));
    return out.join('');
  },
};

// --- hc3://binder ------------------------------------------------------

const BINDER_DEVICE_ID = 4826;

const binder: ResourceDef = {
  uri: 'hc3://binder',
  name: 'Device binder status',
  description: 'Published bindings plus the resolver cache decoded: how many roles sit at L0_cached versus healed, anything missing or ambiguous, and recent heal history. Otherwise only readable by parsing 150+ KB of JSON by hand.',
  mimeType: 'text/markdown',
  async read(hc3) {
    const now = await hc3Now(hc3);
    const out: string[] = [];
    out.push('# Device binder status\n');

    // Published bindings: the flat Stem.group -> {field: deviceId} map that
    // consumers hydrate from.
    const globals: any = await hc3.request('/api/globalVariables').catch(() => null);
    const published = parseJson(
      (Array.isArray(globals) ? globals.find((v: any) => v?.name === 'BinderBindings') : null)?.value ?? null
    );
    if (!published) {
      out.push('\n`BinderBindings` global is absent or not valid JSON — consumers have nothing to hydrate from.\n');
    } else {
      const groups = Object.keys(published);
      const fields = groups.reduce((n, g) => n + Object.keys(published[g] ?? {}).length, 0);
      out.push(`\n## Published bindings\n\n${groups.length} groups, ${fields} fields.\n`);
    }

    // Resolver cache lives on the binder QA, not in the global. Read the one
    // named variable — the array beside it holds credentials.
    const raw = await redactedVarLookup(hc3, BINDER_DEVICE_ID, 'deviceBindings').catch(() => null);
    const cacheDoc = parseJson(raw);
    if (!cacheDoc) {
      out.push(`\n## Resolver cache\n\nCould not read \`deviceBindings\` from QuickApp ${BINDER_DEVICE_ID}, or it is not valid JSON.\n`);
      return out.join('');
    }

    // Cross-check the cache against what config.lua actually declares. A role
    // sitting at L5_missing means two entirely different things depending on
    // whether a descriptor still exists, and they need opposite responses:
    //   - descriptor present  -> the hardware is gone; re-include the device
    //   - descriptor absent   -> nothing asks for this any more; it is a
    //                            stale cache entry to be pruned
    // Reporting them in one undifferentiated list hides the real fault.
    const declared = new Set<string>();
    let descriptorsRead = false;
    try {
      const files: any[] = await hc3.request(`/api/quickApp/${BINDER_DEVICE_ID}/files`) as any[];
      for (const f of files ?? []) {
        const full: any = await hc3.request(
          `/api/quickApp/${BINDER_DEVICE_ID}/files/${encodeURIComponent(f.name)}`
        );
        for (const d of parseBindBlocks(f.name, full?.content ?? '')) {
          for (const e of d.entries) declared.add(`${d.role}.${e.field}`);
        }
      }
      descriptorsRead = declared.size > 0;
    } catch { /* fall through — reported below */ }

    const cache: Record<string, any> = cacheDoc.cache ?? {};
    const roles = Object.keys(cache);
    const byMethod = new Map<string, number>();
    const notCached: string[][] = [];
    const orphaned: string[][] = [];
    const hardwareMissing: string[][] = [];
    for (const role of roles) {
      const entry = cache[role] ?? {};
      const method = String(entry.lastMethod ?? 'unknown');
      byMethod.set(method, (byMethod.get(method) ?? 0) + 1);
      const isDeclared = declared.has(role);
      if (descriptorsRead && !isDeclared) {
        orphaned.push([role, method, String(entry.id ?? '—'), String(entry.name ?? '')]);
      } else if (method === 'L5_missing') {
        hardwareMissing.push([role, String(entry.id ?? '—'), String(entry.name ?? ''), String(entry.type ?? '')]);
      } else if (method !== 'L0_cached') {
        notCached.push([role, method, String(entry.id ?? '—'), String(entry.name ?? '')]);
      }
    }

    out.push(`\n## Resolver cache — ${roles.length} roles\n`);
    if (typeof cacheDoc.savedAt === 'number') {
      out.push(`\nLast saved ${ago(now - cacheDoc.savedAt)}.\n`);
    }
    out.push('\n');
    out.push(table(['Resolution', 'Roles'], [...byMethod.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => [m === 'L0_cached' ? '`L0_cached` (healthy)' : `\`${m}\``, String(n)])));

    out.push('\n### Descriptor cross-check\n');
    out.push(descriptorsRead
      ? `\nRead ${declared.size} declared roles from QuickApp ${BINDER_DEVICE_ID}'s \`bind()\` blocks.\n`
      : `\n_Could not read descriptors from QuickApp ${BINDER_DEVICE_ID}, so orphans cannot be told apart from genuinely missing hardware below._\n`);

    out.push(`\n### Hardware missing — ${hardwareMissing.length}\n`);
    out.push(hardwareMissing.length === 0
      ? '\nNone. Every declared role found its device.\n'
      : '\n**Action: re-include the device.** A descriptor still declares these, but nothing on the gateway matches at any level of the waterfall — so the physical device is gone and consumers fall through to their static defaults.\n\n'
        + table(['Role', 'Last id', 'Expected name', 'Expected type'], hardwareMissing.slice(0, 30)));

    if (descriptorsRead) {
      out.push(`\n### Orphaned cache entries — ${orphaned.length}\n`);
      out.push(orphaned.length === 0
        ? '\nNone. Every cached role is still declared by a descriptor.\n'
        : '\n**Action: prune.** No `bind()` descriptor declares these any more, so the binder will never revisit them — they are leftovers from a retired device. Harmless (publish() skips them) but they mask real faults in any report that walks the cache.\n\n'
          + table(['Role', 'Last method', 'Last id', 'Name'], orphaned.slice(0, 30)));
    }

    out.push(`\n### Healed away from L0 — ${notCached.length}\n`);
    out.push(notCached.length === 0
      ? '\nEvery remaining role resolved straight from cache. Nothing has moved.\n'
      : '\nResolved by the healing waterfall rather than straight from cache, which means a device id moved under them.\n\n'
        + table(['Role', 'Method', 'id', 'Name'], notCached.slice(0, 30)));

    const history: any[] = Array.isArray(cacheDoc.history) ? cacheDoc.history : [];
    out.push(`\n## Heal history — ${history.length} events\n`);
    const recent = history.slice(-15).reverse();
    out.push(recent.length === 0
      ? '\n_No heals recorded._\n'
      : '\n' + table(['When', 'Role', 'Kind', 'Method', 'old → new'], recent.map(h => [
        typeof h.at === 'number' ? ago(now - h.at) : '—',
        String(h.role ?? ''),
        String(h.kind ?? ''),
        String(h.method ?? ''),
        `${h.old ?? '—'} → ${h.new ?? '—'}`,
      ])));

    const drift = Array.isArray(globals) ? globals.find((v: any) => v?.name === 'BinderParamDrift') : null;
    out.push('\n## Z-Wave parameter drift\n');
    if (!drift) {
      out.push('\n`BinderParamDrift` is not set — no drift reported.\n');
    } else {
      const d = parseJson(drift.value);
      const n = d && typeof d === 'object' ? Object.keys(d).length : 0;
      out.push(`\n${n} entr${n === 1 ? 'y' : 'ies'}. Parameters are reported, never auto-written — a replacement may be a different model where the same id means something unsafe.\n`);
    }
    return out.join('');
  },
};

// --- hc3://globals -----------------------------------------------------

const globalsResource: ResourceDef = {
  uri: 'hc3://globals',
  name: 'Globals and automation state',
  description: 'Scalar globals (isDark, debug levels) at a glance, with the large JSON globals decoded to a summary rather than dumped — including the dead-device watcher state.',
  mimeType: 'text/markdown',
  async read(hc3) {
    const [globals, now] = await Promise.all([
      hc3.request('/api/globalVariables') as Promise<any>,
      hc3Now(hc3),
    ]);
    const all: any[] = Array.isArray(globals) ? globals : [];
    const out: string[] = [];
    out.push('# Globals and automation state\n');
    out.push(`_HC3 time ${new Date(now * 1000).toISOString()}._\n`);

    // Scalars first: these are the ones read at a glance. Heartbeats have
    // their own resource, so they are excluded here to avoid duplication.
    const isJson = (v: any) => {
      const s = String(v ?? '');
      return s.startsWith('{') || s.startsWith('[');
    };
    const scalars = all
      .filter(v => !isJson(v.value) && !/Heartbeat$/.test(v.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const structured = all.filter(v => isJson(v.value)).sort((a, b) => a.name.localeCompare(b.name));

    out.push(`\n## Scalar globals — ${scalars.length}\n`);
    out.push(table(['Name', 'Value', 'Last changed'], scalars.map(v => [
      `\`${v.name}\``,
      String(v.value).slice(0, 40) || '_empty_',
      typeof v.modified === 'number' ? ago(now - v.modified) : 'unknown',
    ])));

    out.push(`\n## Structured globals — ${structured.length}\n`);
    out.push('\nSummarised rather than dumped; several run to thousands of bytes.\n\n');
    out.push(table(['Name', 'Size', 'Shape', 'Last changed'], structured.map(v => {
      const parsed = parseJson(String(v.value));
      let shape = 'unparseable';
      if (Array.isArray(parsed)) shape = `array[${parsed.length}]`;
      else if (parsed && typeof parsed === 'object') shape = `object{${Object.keys(parsed).length}}`;
      return [
        `\`${v.name}\``,
        `${String(v.value).length} B`,
        shape,
        typeof v.modified === 'number' ? ago(now - v.modified) : 'unknown',
      ];
    })));

    // Dead-device watcher gets a real decode: it is the one whose contents
    // are routinely worth acting on.
    const ddRaw = all.find(v => v?.name === 'DeadDeviceWatch_State')?.value;
    const dd = parseJson(ddRaw ? String(ddRaw) : null);
    out.push('\n## Dead-device watcher\n');
    if (!dd) {
      out.push('\n`DeadDeviceWatch_State` absent or unparseable.\n');
    } else {
      const devices: Record<string, any> = dd.devices ?? {};
      const ids = Object.keys(devices);
      const currentlyDead = ids.filter(id => devices[id]?.lastSeenDead === true);
      const failing = ids
        .filter(id => (devices[id]?.failCount ?? 0) > 0)
        .sort((a, b) => (devices[b].failCount ?? 0) - (devices[a].failCount ?? 0));
      out.push(`\nWatching ${ids.length} devices. Last run ${typeof dd.lastRun === 'number' ? ago(now - dd.lastRun) : 'unknown'}.\n`);
      out.push(`\nCurrently flagged dead: **${currentlyDead.length}**${currentlyDead.length ? ` (${currentlyDead.slice(0, 20).join(', ')})` : ''}\n`);
      out.push(`\n### Devices with recorded failures — ${failing.length}\n`);
      out.push(failing.length === 0
        ? '\n_None._\n'
        : '\n' + table(['id', 'Fails', 'OK', 'Last action', 'Last tried'], failing.slice(0, 20).map(id => [
          id,
          String(devices[id].failCount ?? 0),
          String(devices[id].okCount ?? 0),
          String(devices[id].lastAction ?? ''),
          typeof devices[id].lastTriedAt === 'number' ? ago(now - devices[id].lastTriedAt) : '—',
        ])));
    }
    return out.join('');
  },
};


// --- hc3://friction ---------------------------------------------------

const friction: ResourceDef = {
  uri: 'hc3://friction',
  name: 'Friction log',
  description: 'Where this server has wasted people\'s time: recurring tool failures, grouped, plus any findings submitted with report_finding. Local only, redacted, nothing transmitted.',
  mimeType: 'text/markdown',
  async read(hc3) {
    const now = await hc3Now(hc3);
    const path = frictionPath();
    const entries = readEntries();
    const out: string[] = [];
    out.push('# Friction log\n');

    if (!path) {
      out.push('\nTelemetry is **not recording**: no writable location, or `MCP_FRICTION_DISABLE=true`.\n');
      out.push('\nUnder a hardened systemd unit (`ProtectSystem=strict`) the service cannot write to `/var/lib` unless the unit grants it. Add `StateDirectory=hc3-mcp` to the unit, or set `MCP_FRICTION_LOG` to a writable path.\n');
      return out.join('');
    }
    out.push(`\n_${entries.length} entries at \`${path}\`. Local only — nothing is transmitted._\n`);
    if (path.includes('/tmp')) {
      out.push('\n**This path is a private /tmp and is wiped whenever the service restarts** — i.e. on every deploy. For history that survives, add `StateDirectory=hc3-mcp` to the systemd unit or set `MCP_FRICTION_LOG`.\n');
    }

    const failures = groupFailures(entries);
    out.push(`\n## Recurring failures — ${failures.length} distinct\n`);
    if (failures.length === 0) {
      out.push('\nNothing recorded. Either nothing has failed, or telemetry started recently.\n');
    } else {
      out.push('\nGrouped by tool and normalised message, most frequent first. A tool failing the same way repeatedly is usually a description gap rather than a user error.\n\n');
      out.push(table(['Count', 'Tool', 'Last seen', 'Message'], failures.slice(0, 25).map(g => [
        String(g.count), `\`${g.tool}\``, ago(now - g.lastSeen),
        g.example.replace(/\|/g, '\\|').slice(0, 120),
      ])));
    }

    const findings = entries.filter(e => e.kind === 'finding').reverse();
    out.push(`\n## Submitted findings — ${findings.length}\n`);
    if (findings.length === 0) {
      out.push('\nNone. Agents and operators can add one with the `report_finding` tool; it requires a single-variable reproduction.\n');
    } else {
      for (const f of findings.slice(0, 15)) {
        out.push(`\n### \`${f.tool}\` — ${ago(now - f.at)}\n`);
        out.push(`\n**Expected:** ${f.finding?.expected}\n`);
        out.push(`\n**Actual:** ${f.finding?.actual}\n`);
        out.push(`\n**Reproduction:**\n\n${f.finding?.reproduction}\n`);
        if (f.finding?.impact) out.push(`\n**Cost:** ${f.finding.impact}\n`);
      }
    }

    out.push('\n## Triage\n');
    out.push('\nNothing here is a verified fact. Every item needs re-testing against the gateway before it changes code or documentation — three claims adopted from plausible reports had to be reversed in a single week. Record a verdict of **confirmed**, **refuted** or **untested** for each, and keep the refutations written down so they are not re-adopted later.\n');
    return out.join('');
  },
};

// --- registry ----------------------------------------------------------

export const RESOURCES: ResourceDef[] = [health, watchdog, binder, globalsResource, friction];

/** Shape expected by MCP `resources/list` — no handlers, no reads performed. */
export function listResources() {
  return RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }));
}

/** Render one resource. Throws with the known URIs if the request misses. */
export async function readResource(hc3: HC3Client, uri: string) {
  const def = RESOURCES.find(r => r.uri === uri);
  if (!def) {
    throw new Error(`Unknown resource '${uri}'. Available: ${RESOURCES.map(r => r.uri).join(', ')}`);
  }
  const text = await def.read(hc3);
  return { contents: [{ uri: def.uri, mimeType: def.mimeType, text }] };
}
