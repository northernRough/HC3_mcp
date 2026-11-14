// Z-Wave diagnostics tools — these don't exist in upstream HC3_mcp
// and are part of the value-adds in this fork. Two of them
// (get_zwave_node_diagnostics, get_zwave_reconfiguration_tasks)
// hit undocumented endpoints discovered by reading the HC3 web UI's
// network traffic.
//
// Schemas exposed by name as `zwaveSchemas.<tool>` because the legacy
// tools/list ordering interleaves them with system tools at scattered
// positions; the server references each schema individually.

import { ToolModule } from './registry';
import { MCPTool } from '../types';
import { isNotFound } from '../hc3-client';

/**
 * Read a device, turning "no such id" into a message that says so.
 *
 * Both tools here open by fetching the device, and in `get_device_parameters`
 * that read is the ONLY unguarded request — the two /api/zwave fetches are
 * caught. So every bare `HTTP 404: Not Found` recorded against it (22 in this
 * project's own friction log, over seventeen days, with no way to tell which
 * device was being asked for) was this one line.
 */
async function readDevice(hc3: any, tool: string, deviceId: number): Promise<any> {
  try {
    return await hc3.request(`/api/devices/${deviceId}`);
  } catch (e: any) {
    if (isNotFound(e)) {
      throw new Error(
        `${tool}: no device ${deviceId} on this HC3. Find the right id with find_devices_by_name or get_devices.`
      );
    }
    throw e;
  }
}

/**
 * Read a node's configuration parameters from HC3's cache.
 *
 * Z-Wave configuration parameters belong to the NODE, and HC3 keeps them under
 * the root address `{nodeId}.0`. Endpoint children (`endPointId` 1, 2, ...) have
 * no entry of their own: `/api/zwave/configuration_parameters/187.1` answers
 * 404. Until 4.39.0 both tools here used `{nodeId}.{endPointId}`, so for 307 of
 * this gateway's 709 parameterised devices get_device_parameters came back
 * empty and set_device_parameter could never see its own write. Root first;
 * the endpoint address only as a fallback.
 */
export async function readNodeParameters(hc3: any, nodeId: any, endpoint: any):
    Promise<{ addr: string; items: any[]; template: any; error?: string }> {
  const addrs = [`${nodeId}.0`];
  if (String(endpoint ?? 0) !== '0') addrs.push(`${nodeId}.${endpoint}`);
  let lastError = '';
  for (const addr of addrs) {
    try {
      const res: any = await hc3.request(`/api/zwave/configuration_parameters/${encodeURIComponent(addr)}`);
      const template: any = await hc3.request(`/api/zwave/parameters_templates/${encodeURIComponent(addr)}`)
        .catch((e: any) => ({ __error: String(e?.message ?? e) }));
      return { addr, items: Array.isArray(res?.items) ? res.items : [], template };
    } catch (e: any) {
      lastError = String(e?.message ?? e);
    }
  }
  return { addr: addrs[0], items: [], template: null, error: lastError };
}

/**
 * A node's cumulative radio frame counters, from the diagnostics HC3's own UI
 * reads. Before 14 Nov 2026 nothing on the REST surface could show whether a
 * parameter write or poll left the controller; these counters can: on node 187
 * they stood still for 30-45 s idle, moved 1 out / 1 in per parameter poll,
 * and 2-3 out per setConfiguration. Other traffic to the node in the same
 * window inflates them, so read a delta as "at least this much went out".
 */
export async function nodeFrames(hc3: any, nodeId: any): Promise<{ in: number; out: number; failed: number } | null> {
  try {
    const r: any = await hc3.request('/api/zwave/nodes/diagnostics/transmissions');
    const n = (Array.isArray(r?.items) ? r.items : []).find((x: any) => String(x.nodeId) === String(nodeId));
    return n ? { in: n.incomingTotal, out: n.outgoingTotal, failed: n.outgoingFailed } : null;
  } catch {
    return null;
  }
}

function frameDelta(a: { in: number; out: number; failed: number } | null, b: { in: number; out: number; failed: number } | null) {
  if (!a || !b) return null;
  return { framesOut: b.out - a.out, framesIn: b.in - a.in, outgoingFailed: b.failed - a.failed };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const zwaveSchemas: Record<string, MCPTool> = {
  get_zwave_mesh_health:
      {
        name: 'get_zwave_mesh_health',
        description: 'Summarise Z-wave mesh health: counts of dead/unconfigured devices, dead devices listed with node IDs and reasons, and breakdowns by room and manufacturer to help identify mesh dead zones. Uses /api/devices?interface=zwave (documented) rather than undocumented /api/diagnostics/* subpaths.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  get_device_parameters:
      {
        name: 'get_device_parameters',
        description: 'Read a Z-Wave device\'s configuration parameters with human-readable labels, descriptions, defaults, and format. For each parameter HC3 knows about the device, returns: parameterNumber, current value, size in bytes, source provenance, label, description, default value, and format. PROVENANCE: the `source` field is verbatim from HC3. `"template"` does NOT mean "catalogue default returned as placeholder" — empirically, parameters with non-default values still carry `source: "template"`. It means the value is from HC3\'s template-backed storage layer: what HC3 recorded the device as being configured to, usually via the HC3 UI\'s native Z-Wave configuration path (which transmits). In normal operation these values match the physical device. LIVE READ-BACK: pass `refreshFromDevice: [numbers]` to ask the node itself first. That uses the per-parameter read the HC3 web interface uses, `POST /api/zwave/polling/configuration_parameters/{addr}/{number}` (the device ACTIONS `getParameter`, `reconfigure` and `pollConfigurationParameter` return not-implemented). Verified 14 Nov 2026 on an FGRGBW442: each poll sends a frame to the node and gets one back (node radio counters still for 30-45 s idle, +1 out / +1 in per poll), and the result reports those counters so you can see it happened. HC3 also refreshes this cache from the device after a setConfiguration write (an out-of-range value was transmitted, refused by the device, and the cache kept the device\'s value). Without `refreshFromDevice` the values are HC3\'s stored copy, which in normal operation matches the device. Parameters belong to the Z-Wave NODE: for an endpoint child (endPointId 1, 2, ...) they are read from the root address `{nodeId}.0`. Sources undocumented endpoints `/api/zwave/configuration_parameters/{addr}` and `/api/zwave/parameters_templates/{addr}` (read-only); may break across HC3 firmware updates.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'HC3 device id of a Z-Wave device (parent or endpoint child). Must have a nodeId in its properties.'
            },
            refreshFromDevice: {
              type: 'array',
              items: { type: 'number' },
              description: 'Optional: parameter numbers (up to 20) to read from the node itself before answering. Each is polled over the radio; the result says which values changed and how many frames went out and came back. Mains-powered nodes only in practice: a sleeping battery node will not answer until it wakes.'
            }
          },
          required: ['deviceId']
        },
      },
  get_zwave_reconfiguration_tasks:
      {
        name: 'get_zwave_reconfiguration_tasks',
        description: 'Active Z-Wave reconfiguration tasks: what HC3 is currently reconfiguring over the mesh. Each task surfaces the device being reconfigured, its nodeId, the task status (Completed, Failed, InProgress, Queued, Downloading, Reconfiguring), whether it is a soft or full reconfiguration, and the count/names of affected child devices. Sources the undocumented endpoint /api/zwaveReconfigurationTasks (read-only); may break across HC3 firmware updates. Use when a reconfigure has been initiated and you want to check progress without opening the HC3 UI. Returns empty list if no task is active.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
  set_device_parameter:
      {
        name: 'set_device_parameter',
        description: 'Write a Z-Wave configuration parameter via the `setConfiguration` device action. Wraps `POST /api/devices/{id}/action/setConfiguration` with body `{args:[parameterNumber, size, value]}` — the working REST path for parameter writes on HC3 firmware 5.x. Reads the parameter before and after the write and reports the diff plus an `actionResponse` envelope from HC3.\n\nWHY THIS EXISTS as a dedicated tool: `control_device` actively rejects `setConfiguration` because most Z-Wave devices do not declare it in their `actions` table; that guard is the right default for unknown action names but blocks this specific, well-attested use case. This tool bypasses the actions-array pre-check for `setConfiguration` only.\n\nALTERNATIVE PATHS (not used here): the documented `setParameter` and `reconfigure` actions, and the `pollConfigurationParameter` ACTION, return `{"error":{"code":-3,"message":"not implemented"}}` on firmware 5.x. The PUT `/api/devices/{id}` `{properties:{parameters:[...]}}` path never transmitted (S14, Zooz ZEN52); on 5.220.15 it is ignored outright, 200 with nothing stored. `modify_device` rejects it. `setConfiguration` is the only working write channel.\n\nVERIFICATION (14 Nov 2026, FGRGBW442 on 5.220.15): the tool reads the node\'s radio frame counters either side of the write and returns them as `radio`. A write moved them 2-3 frames out against none while idle, so `radio.framesOut > 0` is direct evidence the write left the controller for the node. HC3 then refreshes its parameter cache FROM THE DEVICE: a valid value appeared in the cache; an out-of-range value was transmitted, refused by the device, and the cache kept the device\'s old value. So `transmitted: true` with `cacheUpdated: false` means the cache shows what the device actually holds: either the DEVICE refused the value (out of range, read-only), or the parameter is a one-shot trigger that resets itself after acting (Qubino Mini Dimmer 71 = 2: forced calibration, lights flash on about 2 s, reads 0 again). Parameters are read at the node\'s root address `{nodeId}.0`, also for endpoint children. To read a value from the device later, use get_device_parameters with `refreshFromDevice`. Earlier evidence: a behavioural test on an FGD212 (auto-off param 10, 9 May 2026) and working production scenes.\n\nGUARDS: refuses devices with no Z-Wave `nodeId`; refuses `deviceId < 10` (HC3 system devices); validates `parameterNumber` (1-255), `size` (1, 2, or 4), and integer `value`. Some parameters are read-only at the device-firmware level (e.g. FGD212 14, 31, 33; Qubino Mini Dimmer 72) — the cache may appear to update but the device discards the write; this is a device-firmware concern, not a guardrail this tool can enforce.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'HC3 device id of the Z-Wave node (parent or endpoint child). The action is sent to this device; the parameter cache is read at the node\'s root address `{nodeId}.0`.'
            },
            parameterNumber: {
              type: 'number',
              description: 'Z-Wave configuration parameter number (1-255). Look up valid parameters via get_device_parameters.'
            },
            size: {
              type: 'number',
              enum: [1, 2, 4],
              description: 'Parameter size in bytes — 1, 2, or 4. Must match the device\'s declared size for this parameter; mismatched size will be encoded incorrectly. Look up the correct size via get_device_parameters.'
            },
            value: {
              type: 'number',
              description: 'Integer value to write. Range depends on size and parameter encoding (signed vs unsigned, ranges, enum domains) — consult the parameter\'s template via get_device_parameters before writing.'
            }
          },
          required: ['deviceId', 'parameterNumber', 'size', 'value']
        },
      },
  get_zwave_node_diagnostics:
      {
        name: 'get_zwave_node_diagnostics',
        description: 'Per-node Z-Wave transmission counters: incoming/outgoing frame totals, outgoing failures, incoming CRC/S0/S2/TransportService/MultiChannel failures, and nonce exchange counts. Enriches each node with device name, room, and a computed outgoingFailedPercent so problem nodes surface immediately. Counters are cumulative since the controller last reset them. Sources the undocumented endpoint /api/zwave/nodes/diagnostics/transmissions (read-only); may break across HC3 firmware updates. Use for identifying which Z-Wave nodes are experiencing retries, CRC errors, or security-layer negotiation problems.',
        inputSchema: {
          type: 'object',
          properties: {
            min_outgoing_failed_percent: {
              type: 'number',
              description: 'If set, only return nodes whose outgoingFailedPercent is >= this threshold (0-100). Useful to filter to problem nodes only.'
            },
            sort_by: {
              type: 'string',
              enum: ['outgoingFailedPercent', 'outgoingFailed', 'incomingTotal', 'outgoingTotal', 'nodeId'],
              description: 'Field to sort nodes by, descending (except nodeId which is ascending). Defaults to outgoingFailedPercent.'
            }
          },
        },
      },
};

export const zwave: ToolModule = {
  schemas: Object.values(zwaveSchemas),

  handlers: {
    async get_zwave_mesh_health(hc3): Promise<any> {
      const [devices, rooms] = await Promise.all([
        hc3.request('/api/devices?interface=zwave'),
        hc3.request('/api/rooms')
      ]);

      const roomNameById: Record<number, string> = {};
      for (const r of rooms) roomNameById[r.id] = r.name;

      const nodes: any[] = (devices as any[]).filter(d => d?.properties?.nodeId !== undefined);
      const dead = nodes.filter(d => d.properties.dead === true);
      const unconfigured = nodes.filter(d => d.properties.configured === false);

      const deadByRoom: Record<string, number> = {};
      const deadByManufacturer: Record<string, number> = {};
      for (const d of dead) {
        const roomName = roomNameById[d.roomID] ?? `room ${d.roomID}`;
        deadByRoom[roomName] = (deadByRoom[roomName] ?? 0) + 1;
        const mfr = d.properties.zwaveCompany || 'Unknown';
        deadByManufacturer[mfr] = (deadByManufacturer[mfr] ?? 0) + 1;
      }

      return {
        total_zwave_devices: nodes.length,
        dead_count: dead.length,
        dead_rate_pct: nodes.length > 0 ? Math.round((dead.length / nodes.length) * 1000) / 10 : 0,
        unconfigured_count: unconfigured.length,
        dead_devices: dead.map(d => ({
          id: d.id,
          name: d.name,
          nodeId: d.properties.nodeId,
          roomID: d.roomID,
          roomName: roomNameById[d.roomID] ?? null,
          deadReason: d.properties.deadReason || null,
          zwaveCompany: d.properties.zwaveCompany || null
        })),
        unconfigured_devices: unconfigured.map(d => ({
          id: d.id,
          name: d.name,
          nodeId: d.properties.nodeId,
          roomID: d.roomID,
          roomName: roomNameById[d.roomID] ?? null
        })),
        dead_by_room: deadByRoom,
        dead_by_manufacturer: deadByManufacturer
      };
    },

    async get_zwave_node_diagnostics(hc3, args: { min_outgoing_failed_percent?: number; sort_by?: string }): Promise<any> {
      // Schema declares snake_case (min_outgoing_failed_percent / sort_by) so
      // that's the wire shape this handler receives. The legacy in-class
      // method took camelCase positional args; the snake→positional mapping
      // happened in the dispatch case arm. Now lifted here.
      const minOutgoingFailedPercent = args?.min_outgoing_failed_percent;
      const sortBy = args?.sort_by;
      const [transmissions, devices, rooms] = await Promise.all([
        hc3.request('/api/zwave/nodes/diagnostics/transmissions'),
        hc3.request('/api/devices?interface=zwave'),
        hc3.request('/api/rooms')
      ]);

      const roomNameById: Record<number, string> = {};
      for (const r of rooms) roomNameById[r.id] = r.name;

      const deviceByNodeId: Record<number, any> = {};
      for (const d of devices as any[]) {
        const nid = d?.properties?.nodeId;
        if (nid !== undefined && deviceByNodeId[nid] === undefined) deviceByNodeId[nid] = d;
      }

      const items: any[] = (transmissions?.items as any[]) || [];
      const enriched = items.map(n => {
        const dev = deviceByNodeId[n.nodeId];
        const incomingFailedTotal =
          (n.incomingFailedUndefined || 0) +
          (n.incomingFailedCrc || 0) +
          (n.incomingFailedS0 || 0) +
          (n.incomingFailedS2 || 0) +
          (n.incomingFailedTransportService || 0) +
          (n.incomingFailedMultiChannel || 0);
        const outgoingFailedPercent = n.outgoingTotal > 0
          ? Math.round((n.outgoingFailed / n.outgoingTotal) * 1000) / 10
          : 0;
        return {
          nodeId: n.nodeId,
          deviceName: dev?.name ?? null,
          deviceId: dev?.id ?? null,
          roomName: dev ? (roomNameById[dev.roomID] ?? null) : null,
          zwaveCompany: dev?.properties?.zwaveCompany ?? null,
          incomingTotal: n.incomingTotal,
          incomingFailedTotal,
          incomingFailedUndefined: n.incomingFailedUndefined,
          incomingFailedCrc: n.incomingFailedCrc,
          incomingFailedS0: n.incomingFailedS0,
          incomingFailedS2: n.incomingFailedS2,
          incomingFailedTransportService: n.incomingFailedTransportService,
          incomingFailedMultiChannel: n.incomingFailedMultiChannel,
          incomingNonceGet: n.incomingNonceGet,
          incomingNonceReport: n.incomingNonceReport,
          outgoingTotal: n.outgoingTotal,
          outgoingFailed: n.outgoingFailed,
          outgoingFailedPercent,
          outgoingNonceGet: n.outgoingNonceGet,
          outgoingNonceReport: n.outgoingNonceReport
        };
      });

      const filtered = typeof minOutgoingFailedPercent === 'number'
        ? enriched.filter(n => n.outgoingFailedPercent >= minOutgoingFailedPercent)
        : enriched;

      const sortKey = sortBy || 'outgoingFailedPercent';
      const sorted = [...filtered].sort((a: any, b: any) => {
        if (sortKey === 'nodeId') return a.nodeId - b.nodeId;
        return (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
      });

      return {
        source: '/api/zwave/nodes/diagnostics/transmissions (undocumented)',
        counters_are: 'cumulative since last controller reset',
        node_count: sorted.length,
        nodes: sorted
      };
    },

    async get_device_parameters(hc3, args: { deviceId: number; refreshFromDevice?: number[] }): Promise<any> {
      const deviceId = args?.deviceId;
      if (typeof deviceId !== 'number') {
        throw new Error('get_device_parameters requires a numeric deviceId.');
      }
      const device: any = await readDevice(hc3, 'get_device_parameters', deviceId);
      const nodeId = device?.properties?.nodeId;
      if (nodeId === undefined || nodeId === null) {
        throw new Error(
          `Device ${deviceId} (${device?.name}) has no Z-Wave nodeId; get_device_parameters only supports Z-Wave devices.`
        );
      }
      const endpoint = device?.properties?.endPointId ?? 0;
      // Clients holding a schema from before 4.39.0 send the array as a string
      // ("[66, 62]"); accept that, and a bare comma list, rather than refuse.
      let refresh: any = args?.refreshFromDevice;
      if (typeof refresh === 'string') {
        const t = refresh.trim();
        try { refresh = t.startsWith('[') ? JSON.parse(t) : t.split(',').filter(Boolean).map(x => Number(x.trim())); }
        catch { /* left as a string: refused below */ }
      }
      if (refresh !== undefined && (!Array.isArray(refresh) || refresh.length > 20 ||
          refresh.some((n: any) => !Number.isInteger(n) || n < 1 || n > 255))) {
        throw new Error('get_device_parameters: refreshFromDevice must be an array of up to 20 parameter numbers (1-255).');
      }

      let read = await readNodeParameters(hc3, nodeId, endpoint);
      let refreshed: any = undefined;
      if (refresh?.length) {
        const cached = new Map<number, any>(read.items.map((v: any) => [v.parameterNumber, v.configurationValue]));
        const f0 = await nodeFrames(hc3, nodeId);
        const polls: Record<number, number | string> = {};
        for (const n of refresh) {
          try {
            await hc3.request(`/api/zwave/polling/configuration_parameters/${encodeURIComponent(read.addr)}/${n}`, 'POST', {});
            polls[n] = 'accepted';
          } catch (e: any) {
            polls[n] = String(e?.message ?? e);
          }
        }
        await sleep(3000);
        const f1 = await nodeFrames(hc3, nodeId);
        read = await readNodeParameters(hc3, nodeId, endpoint);
        const radio = frameDelta(f0, f1);
        refreshed = {
          polled: polls,
          changed: read.items
            .filter((v: any) => refresh.includes(v.parameterNumber) && cached.get(v.parameterNumber) !== v.configurationValue)
            .map((v: any) => ({ parameterNumber: v.parameterNumber, was: cached.get(v.parameterNumber), now: v.configurationValue })),
          radio,
          note: radio === null
            ? 'Node radio counters unavailable, so it cannot be shown that the polls reached the node.'
            : radio.framesOut === 0
              ? 'No frames went to the node: the polls did not reach it (asleep, dead, or HC3 dropped them). Values below are the cached copy.'
              : `${radio.framesOut} frame(s) went to the node and ${radio.framesIn} came back during the polls (other traffic in the same 3 s can add to these). ` +
                'Values below are as HC3 holds them after that exchange.'
        };
      }
      const { addr } = read;
      const templateRes: any = read.template ?? {};

      const values: any[] = read.items;
      const templateParams: any[] = Array.isArray((templateRes as any)?.parameters) ? (templateRes as any).parameters : [];
      const templateByNumber = new Map<number, any>(
        templateParams.map(p => [p.parameterNumber, p])
      );

      const pickEn = (localised: any): string | null => {
        if (typeof localised === 'string') return localised;
        if (localised && typeof localised === 'object') return localised.en ?? null;
        return null;
      };

      const merged = values.map(v => {
        const tpl = templateByNumber.get(v.parameterNumber) ?? {};
        return {
          parameterNumber: v.parameterNumber,
          value: v.configurationValue,
          size: v.size,
          source: v.source?.type ?? null,
          label: pickEn(tpl.label),
          description: pickEn(tpl.description),
          defaultValue: tpl.defaultValue ?? null,
          format: tpl.format ?? null
        };
      });

      const storedOnly = values.every(v => v.source?.type === 'template');

      return {
        deviceId,
        deviceName: device?.name ?? null,
        nodeId,
        endpoint,
        addr,
        productType: (templateRes as any)?.description ?? null,
        ...(read.error ? { readError: `HC3 has no parameter record for node ${nodeId}: ${read.error}` } : {}),
        ...(refreshed ? { refreshFromDevice: refreshed } : {}),
        parameters: merged,
        provenance_note:
          'Values are from HC3\'s stored-values layer, which HC3 updates from the device after a ' +
          'setConfiguration write and after a poll. To have the node asked now, pass refreshFromDevice. ' +
          'Parameters belong to the Z-Wave node, so an endpoint child shows its root node\'s set. ' +
          '`source: "template"` on a parameter means "stored in HC3\'s ' +
          'template-backed storage", NOT "this is the catalogue default". Empirically, parameters with ' +
          'non-default values still carry source "template".',
        all_values_are_hc3_stored: storedOnly
      };
    },

    async set_device_parameter(hc3, args: {
      deviceId: number;
      parameterNumber: number;
      size: number;
      value: number;
    }): Promise<any> {
      const { deviceId, parameterNumber, size, value } = args ?? {} as any;

      if (typeof deviceId !== 'number' || deviceId < 10) {
        throw new Error(
          `set_device_parameter: invalid deviceId ${deviceId} — must be a number >= 10 (HC3 system devices < 10 are reserved).`
        );
      }
      if (!Number.isInteger(parameterNumber) || parameterNumber < 1 || parameterNumber > 255) {
        throw new Error(
          `set_device_parameter: parameterNumber must be an integer 1-255 (got ${parameterNumber}).`
        );
      }
      if (size !== 1 && size !== 2 && size !== 4) {
        throw new Error(
          `set_device_parameter: size must be 1, 2, or 4 (got ${size}).`
        );
      }
      if (!Number.isInteger(value)) {
        throw new Error(
          `set_device_parameter: value must be an integer (got ${value}).`
        );
      }

      const device: any = await readDevice(hc3, 'set_device_parameter', deviceId);
      const nodeId = device?.properties?.nodeId;
      if (nodeId === undefined || nodeId === null) {
        throw new Error(
          `set_device_parameter: device ${deviceId} (${device?.name ?? '?'}) has no Z-Wave nodeId — not a Z-Wave device.`
        );
      }
      const endpoint = device?.properties?.endPointId ?? 0;
      let addr = `${nodeId}.0`;

      const readOne = async (): Promise<{ value: number; size: number; source: string | null } | null> => {
        const r = await readNodeParameters(hc3, nodeId, endpoint);
        addr = r.addr;
        const entry = r.items.find((p: any) => p.parameterNumber === parameterNumber);
        if (!entry) return null;
        return {
          value: entry.configurationValue,
          size: entry.size,
          source: entry.source?.type ?? null
        };
      };

      const before = await readOne();
      const framesBefore = await nodeFrames(hc3, nodeId);

      const actionResponse: any = await hc3.request(
        `/api/devices/${deviceId}/action/setConfiguration`,
        'POST',
        { args: [parameterNumber, size, value] }
      );

      // HC3's cache for /api/zwave/configuration_parameters/{addr} can take
      // a couple of seconds to reflect a setConfiguration write. Poll with
      // backoff so the happy-path stays fast while slow updates still land
      // a true cacheUpdated. Cap at ~3.5s total (500 + 1000 + 2000 ms).
      let after: { value: number; size: number; source: string | null } | null = null;
      for (const delayMs of [500, 1000, 2000]) {
        await new Promise(r => setTimeout(r, delayMs));
        after = await readOne();
        if (after !== null && after.value === value) break;
      }

      const cacheUpdated = after !== null && after.value === value;
      const radio = frameDelta(framesBefore, await nodeFrames(hc3, nodeId));
      const transmitted = radio === null ? null : radio.framesOut > 0;

      // cacheUpdated:false used to read as "the write failed". It does not
      // mean that: on 17 Oct 2026 (5.220.15) two FGR223 parents showed
      // cacheUpdated:false AND an event-log isSupportedByDevice:false, and the
      // blinds' slats then rotated as the new value dictated: it transmitted.
      const props = device?.properties ?? {};
      const battery = props.batteryLevel !== undefined || (typeof props.wakeUpTime === 'number' && props.wakeUpTime > 0);
      const batteryNote = battery ? ' This is a BATTERY device: a parameter write can only reach it when it wakes up, and HC3 shows nothing ' +
        'to say it is queued (pendingActions stays false). Wake it, or wait for its wake-up interval.' : '';
      const outcome = transmitted === true && cacheUpdated
        ? `Transmitted (${radio!.framesOut} frame(s) out, ${radio!.framesIn} back) and HC3's cache now holds ${value}, which it refreshes from the device after a write.`
        : transmitted === true && after !== null
          ? `Transmitted (${radio!.framesOut} frame(s) out, ${radio!.framesIn} back), but the cache still holds ${after.value}. HC3 refreshes ` +
            'this cache from the device after a write, so either the device REFUSED the value (outside its range, or read-only), ' +
            'or this is a TRIGGER parameter that acts and resets itself (Qubino Mini Dimmer 71 = 2 forces a calibration, ' +
            'about 2 s with the lights flashing on, and reads 0 again afterwards: 14 Nov 2026). Check the parameter\'s format ' +
            'in get_device_parameters, and the device itself.'
        : transmitted === true
          ? `Transmitted (${radio!.framesOut} frame(s) out, ${radio!.framesIn} back). HC3 holds no cached entry for this parameter to compare.`
        : transmitted === false
          ? 'NO frames went to the node during the write, so it did not reach the device yet.' +
            (batteryNote || ' The node may be dead or unreachable; check get_zwave_mesh_health.')
        : cacheUpdated
          ? 'HC3 stored the new value (radio counters unavailable to show transmission).'
        : 'NOT a failure signal by itself: HC3 did not update its cached copy, but on this firmware writes have transmitted with ' +
          'cacheUpdated:false and an event-log isSupportedByDevice:false (FGR223, 17 Oct 2026). Judge by the device\'s behaviour ' +
          'or a property that depends on the parameter, not by these fields.' + batteryNote;

      return {
        deviceId,
        deviceName: device?.name ?? null,
        nodeId,
        endpoint,
        addr,
        parameterNumber,
        submittedSize: size,
        submittedValue: value,
        before,
        after,
        cacheUpdated,
        transmitted,
        radio,
        outcome,
        ...(battery ? { batteryDevice: true } : {}),
        actionResponse
      };
    },

    async get_zwave_reconfiguration_tasks(hc3): Promise<any> {
      const [tasks, devices, rooms] = await Promise.all([
        hc3.request('/api/zwaveReconfigurationTasks'),
        hc3.request('/api/devices?interface=zwave'),
        hc3.request('/api/rooms')
      ]);

      const roomNameById: Record<number, string> = {};
      for (const r of rooms) roomNameById[r.id] = r.name;

      const roomIdByDeviceId: Record<number, number> = {};
      for (const d of devices as any[]) {
        if (d?.id !== undefined && d?.roomID !== undefined) roomIdByDeviceId[d.id] = d.roomID;
      }

      const items: any[] = Array.isArray(tasks) ? tasks : [];
      const enriched = items.map((t: any) => {
        const roomId = roomIdByDeviceId[t.deviceId];
        const children: any[] = Array.isArray(t.childDevices) ? t.childDevices : [];
        return {
          id: t.id,
          status: t.status,
          deviceId: t.deviceId,
          deviceName: t.name ?? null,
          roomName: roomId !== undefined ? (roomNameById[roomId] ?? null) : null,
          nodeId: t.nodeId,
          softReconfiguration: t.softReconfiguration,
          battery: t.battery,
          remoteGateway: t.remoteGateway || null,
          childDeviceCount: children.length,
          childDeviceNames: children.map(c => c?.data?.name).filter((n: any) => typeof n === 'string').slice(0, 20)
        };
      });

      return {
        source: '/api/zwaveReconfigurationTasks (undocumented)',
        task_count: enriched.length,
        tasks: enriched
      };
    },
  },
};
