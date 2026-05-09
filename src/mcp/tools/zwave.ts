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
        description: 'Read a Z-Wave device\'s configuration parameters with human-readable labels, descriptions, defaults, and format. For each parameter HC3 knows about the device, returns: parameterNumber, current value, size in bytes, source provenance, label, description, default value, and format. PROVENANCE: the `source` field is verbatim from HC3. `"template"` does NOT mean "catalogue default returned as placeholder" — empirically, parameters with non-default values still carry `source: "template"`. It means the value is from HC3\'s template-backed storage layer: what HC3 recorded the device as being configured to, usually via the HC3 UI\'s native Z-Wave configuration path (which transmits). In normal operation these values match the physical device. What HC3 5.x cannot do over REST is re-verify the stored value against the physical device on demand (the mesh read-back path — `getParameter`, `reconfigure`, `pollConfigurationParameter` — is not-implemented or silently no-ops). So treat returned values as "HC3\'s best knowledge, almost certainly accurate", not "guaranteed live readback". Drift from physical reality only occurs if the device was reset physically, a different controller reached it, or someone used the broken PUT `/api/devices/{id}` `{properties: {parameters: [...]}}` path (see S14 — `modify_device` rejects it for this reason). Sources undocumented endpoints `/api/zwave/configuration_parameters/{addr}` and `/api/zwave/parameters_templates/{addr}` (read-only); may break across HC3 firmware updates.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'HC3 device id of a Z-Wave device. Must have a nodeId in its properties.'
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
        description: 'Write a Z-Wave configuration parameter via the `setConfiguration` device action. Wraps `POST /api/devices/{id}/action/setConfiguration` with body `{args:[parameterNumber, size, value]}` — the working REST path for parameter writes on HC3 firmware 5.x. Reads the parameter before and after the write and reports the diff plus an `actionResponse` envelope from HC3.\n\nWHY THIS EXISTS as a dedicated tool: `control_device` actively rejects `setConfiguration` because most Z-Wave devices do not declare it in their `actions` table; that guard is the right default for unknown action names but blocks this specific, well-attested use case. This tool bypasses the actions-array pre-check for `setConfiguration` only.\n\nALTERNATIVE PATHS (not used here): the documented `setParameter` and `reconfigure` actions, and the dedicated `pollConfigurationParameter`, return `{"error":{"code":-3,"message":"not implemented"}}` on firmware 5.x. The PUT `/api/devices/{id}` `{properties:{parameters:[...]}}` path silently caches without transmitting (S14 — `modify_device` rejects this). `setConfiguration` is the only working channel.\n\nVERIFICATION: HC3 5.x has no mesh read-back path, so a single REST call cannot prove the value reached the physical device. Empirical evidence is strong — multiple working production scenes (e.g. the Fibaro forum `er` rule pattern from jgab April 2024, and the local `Re-calibrate Qubino Dimmers on power restart` scene 285) treat `setConfiguration` as transmitting; on 2026-05-09 a behavioural test on a Fibaro FGD212 (auto-off param 10) confirmed transmission on firmware 5.203.68 (the device autonomously switched off after the configured delay). The strongest single-call signal this tool can return is `cacheUpdated: true` plus a clean `actionResponse.error: null`; for safety-critical writes, observe the device.\n\nGUARDS: refuses devices with no Z-Wave `nodeId`; refuses `deviceId < 10` (HC3 system devices); validates `parameterNumber` (1-255), `size` (1, 2, or 4), and integer `value`. Some parameters are read-only at the device-firmware level (e.g. FGD212 14, 31, 33; Qubino Mini Dimmer 72) — the cache may appear to update but the device discards the write; this is a device-firmware concern, not a guardrail this tool can enforce.',
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'number',
              description: 'HC3 device id of the Z-Wave node (parent or endpoint child). The tool resolves the node\'s `nodeId.endPointId` address from the device record.'
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

    async get_device_parameters(hc3, args: { deviceId: number }): Promise<any> {
      const deviceId = args?.deviceId;
      if (typeof deviceId !== 'number') {
        throw new Error('get_device_parameters requires a numeric deviceId.');
      }
      const device: any = await hc3.request(`/api/devices/${deviceId}`);
      const nodeId = device?.properties?.nodeId;
      if (nodeId === undefined || nodeId === null) {
        throw new Error(
          `Device ${deviceId} (${device?.name}) has no Z-Wave nodeId; get_device_parameters only supports Z-Wave devices.`
        );
      }
      const endpoint = device?.properties?.endPointId ?? 0;
      const addr = `${nodeId}.${endpoint}`;
      const encodedAddr = encodeURIComponent(addr);

      const [valuesRes, templateRes] = await Promise.all([
        hc3.request(`/api/zwave/configuration_parameters/${encodedAddr}`)
          .catch((e: any) => ({ __error: String(e?.message ?? e) })),
        hc3.request(`/api/zwave/parameters_templates/${encodedAddr}`)
          .catch((e: any) => ({ __error: String(e?.message ?? e) }))
      ]);

      const values: any[] = Array.isArray((valuesRes as any)?.items) ? (valuesRes as any).items : [];
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
        parameters: merged,
        provenance_note:
          'Values are from HC3\'s stored-values layer, normally populated when the device was configured ' +
          'via HC3\'s native Z-Wave path (the HC3 UI, which transmits). In normal operation they match ' +
          'the physical device. HC3 5.x cannot re-verify them over REST on demand — the mesh read-back ' +
          'path is not-implemented on this firmware — so treat the values as "almost certainly correct, ' +
          'not programmatically re-provable". Drift from physical reality only occurs if the device was ' +
          'physically reset, a different controller reached it, or someone used the PUT ' +
          '/api/devices/{id} {properties: {parameters:[...]}} path (cache-only — modify_device rejects ' +
          'this for the same reason). `source: "template"` on a parameter means "stored in HC3\'s ' +
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

      const device: any = await hc3.request(`/api/devices/${deviceId}`);
      const nodeId = device?.properties?.nodeId;
      if (nodeId === undefined || nodeId === null) {
        throw new Error(
          `set_device_parameter: device ${deviceId} (${device?.name ?? '?'}) has no Z-Wave nodeId — not a Z-Wave device.`
        );
      }
      const endpoint = device?.properties?.endPointId ?? 0;
      const addr = `${nodeId}.${endpoint}`;
      const encodedAddr = encodeURIComponent(addr);

      const readOne = async (): Promise<{ value: number; size: number; source: string | null } | null> => {
        try {
          const res: any = await hc3.request(`/api/zwave/configuration_parameters/${encodedAddr}`);
          const items: any[] = Array.isArray(res?.items) ? res.items : [];
          const entry = items.find((p: any) => p.parameterNumber === parameterNumber);
          if (!entry) return null;
          return {
            value: entry.configurationValue,
            size: entry.size,
            source: entry.source?.type ?? null
          };
        } catch {
          return null;
        }
      };

      const before = await readOne();

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
        actionResponse,
        transmissionNote:
          'cacheUpdated=true means HC3 accepted and stored the new value. Whether the value transmitted to the physical Z-Wave device is NOT programmatically verifiable on HC3 5.x firmware (no mesh read-back path). Empirically, setConfiguration does transmit on this firmware (proven on Fibaro FGD212, 2026-05-09). For safety-critical writes, observe device behaviour or read the relevant device property afterwards.'
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
