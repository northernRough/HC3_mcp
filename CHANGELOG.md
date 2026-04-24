# Change Log

All notable changes to the "hc3-mcp-server" extension will be documented in this file.

## [2.10.0] - 2026-04-24

### Added
- Profile management — four tools covering the practical Home/Away/Vacation orchestration workflow, wrapping the `/api/profiles` surface:
  - `get_profiles` — list profiles + activeProfile id
  - `get_profile` — one profile's devices/scenes/climateZones/partitions detail
  - `activate_profile` — switch active profile, with post-activation refetch verify
  - `modify_profile` — read-modify-write + verifyWrite on a partial fields update (name, iconId, devices, scenes, climateZones, partitions)

Profile CRUD (`create_profile`, `delete_profile`), `reset_profiles`, and per-child-entity PUTs (`/profiles/{id}/scenes/{sid}` etc.) intentionally skipped for now as edge cases; the four shipped cover the practical orchestration workflow.

## [2.9.0] - 2026-04-24

### Added
- `run_scene_sync` — synchronous scene execution via `POST /api/scenes/{id}/executeSync`. Unlike `run_scene` (fires async and returns immediately), this waits for the scene to finish before returning. Useful for sequencing dependent automation steps. Returns `{sceneId, mode: 'sync', elapsedMs}`.
- `clear_debug_messages` — `DELETE /api/debugMessages`. Reads the current count first and returns `{cleared: N}` so the caller knows how many were dropped. Useful for test loops — clear before a scene/QA action, then `get_debug_messages` to see only the fresh logs.

## [2.8.0] - 2026-04-24

### Added
- `delete_device` — per-device deletion by id via DELETE /api/devices/{id}. Guards: refuses ids < 10 (system-reserved); refuses Z-Wave physical devices unless `allow_physical=true` (REST delete skips mesh exclusion and leaves a ghost node on the controller); refuses devices with children unless `cascade=true` (rejection includes child count + first 10 names so the blast radius is visible). Post-delete verified by refetch expecting 404. Returns `{deleted, name, type, wasQuickApp, wasPlugin, childrenRemovedWith}`.
- `delete_global_variable` — global-variable deletion by name via DELETE /api/globalVariables/{name}. Reads the variable first to capture `lastValue` (returned in the response as a recovery trail) and the readOnly / isEnum flags. Refuses readOnly system globals unless `allow_system=true`. Post-delete verified by refetch expecting 404.

### Changed
- `delete_plugin` semantics clarified (non-breaking): description now makes plain this is a BULK uninstall of every device of a given plugin type, and directs callers to the new `delete_device` for per-device removal. Added a safety guard — when more than one device of the type exists, the tool refuses unless `allow_bulk=true`. Guard caught a real risk on a live HC3: `type: com.fibaro.genericDevice` would uninstall three unrelated user QAs at once; old unguarded behaviour would silently wipe them.

## [2.7.0] - 2026-04-23

### Added
- `snapshot` — single-call dump of every mutable HC3 configuration surface for backup regimes and drift detection. Read-only. Per-surface atomicity via `Promise.allSettled`: one failing surface doesn't abort others; failures land in `surfaceErrors`. Default set (`devices`, `rooms`, `scenes`, `quickapps` with per-file content, `globals`, `custom-events`, `alarm`, `climate`, `system`, `users`, `hc3-docs`) runs in ~1s on a household HC3 (1006 devices, 20 QAs, 36 QA files). Opt-in surface `zwave-parameters` iterates per-Z-Wave-device with `concurrency=8`; ~3s for 185 devices / 3141 params on this firmware. Include-list and exclude-list filters; unknown surface names silently dropped. Returns `{capturedAt, elapsedMs, surfaces, surfaceErrors, includeResolved}`. Motivated by the 2026-04-23 user-rights incident where recovery required scavenging state from a Claude Code transcript — a routine snapshot regime would have prevented the scramble.

## [2.6.0] - 2026-04-23

### Added
- `update_user_rights` — write counterpart to `get_users` for modifying a user's access rights (`devices` / `scenes` / `climateZones` / `profiles` / `alarmPartitions`). Follows the standard read-modify-write + post-write-verify pattern: reads current user, deep-merges the submitted `rights.*` subkeys onto current, full-array-replaces leaf arrays (matching HC3 PUT semantics). Post-write refetch verifies every submitted array member is present; mismatches throw. **Send-shape detail:** PUTs only `{rights: merged}` rather than the full user record — HC3 rejects full-record echo-back with `403 "Terms of service acceptance change forbidden"` because admin users cannot toggle another user's `tosAccepted` / `privacyPolicyAccepted` flags. Completes the bundle alongside `find_devices_by_name` / `find_device_by_endpoint` for manifest-driven user-rights sync resilient to Z-Wave re-inclusion.
- Safety guards: rejects `rights.advanced.*` writes unless `allow_advanced_rights=true` (17 sensitive subkeys including `zWave`/`backup`/`access`/`update` — privilege-escalation footgun); rejects `rights.<category>.all=true` mass-grants unless `allow_grant_all=true`; rejects writes targeting `type: "superuser"` users outright.

## [2.5.0] - 2026-04-23

### Added
- `find_device_by_endpoint` — resolve a multi-endpoint child device by its `(parentId, endpointId)` pair. Stable identity for children that survives Z-Wave re-inclusion: `parentId` is resolved via the parent's (stable) name, `endPointId` is the Z-Wave endpoint number which never shifts. Pairs with `find_devices_by_name`. Returns an ARRAY of matches (not single + null) because endpoint 0 is commonly ambiguous: multi-endpoint parents expose multiple child roles at endpoint 0 (e.g. a ZEN52 wrapper has both a binarySwitch and a remoteController at endpoint 0; an AEON MultiSensor has motion/temp/lux/humidity siblings there). Non-zero endpoints are usually unique. Building block — together with `find_devices_by_name` — for manifest-driven sync that survives Z-Wave re-inclusion.

## [2.4.1] - 2026-04-23

### Fixed
- `find_devices_by_name` top-level filter broadened from `parentId === 0` to `parentId in {0, 1}`. On HC3 the physical Z-Wave device nodes are children of the Z-Wave root controller (device id 1), not `parentId==0`, so the original filter missed 187 of the 252 genuinely top-level devices on a typical household install (all the blinds, Walli switches, single-node sensors). 2.4.0 returned empty for most real-world name searches. Known follow-up (not in this patch): multi-sensor children whose parent is a Z-Wave node (e.g. AEON MultiSensor 6 — the "right nite motion" child is at `parentId=<node>`, `endPointId=0`, distinguished from its "right nite temp" and "right nite lux" siblings by `type` rather than endpoint) — still not findable via this tool; would need a separate `find_child_by_type(parentId, type)` or equivalent.

## [2.4.0] - 2026-04-23

### Added
- `find_devices_by_name` — resolve a human-readable device name to one or more HC3 devices without pulling the full `/api/devices` payload (~4 MB on a 1000-device install). Case-insensitive substring match by default, `exactMatch` opt-in, optional `roomId` narrowing and `visibleOnly` flag. Filters to parent/top-level devices only (`parentId === 0`) — child endpoints of multi-endpoint Z-Wave devices and child QAs are excluded; a separate sibling tool will handle child-endpoint resolution. HC3 has no native name filter on `/api/devices` (the documented `?property=...&value=...` filter only applies to `properties.*` fields, not top-level `name`), so this filters in-process. Returns minimal `{id, name, roomID, type, visible, enabled, dead}` records. Building block for manifest-driven name→id resolution that survives Z-Wave re-inclusion.

## [2.3.0] - 2026-04-23

Gap-filling release after an audit of HC3's authoritative OpenAPI specs at `/assets/docs/hc/plugins.json` and `/assets/docs/hc/quickapp.json` (not linked from the public Swagger UI — credit jgab for surfacing them).

### Added
- `create_quickapp` — create a brand-new empty QuickApp on HC3 from scratch (as opposed to `import_quickapp`, which loads a .fqa). Wraps `POST /api/quickApp`. Accepts `name`, `type`, optional `roomId` / `initialProperties` / `initialInterfaces` / `initialView`. Returns the HC3-assigned `deviceId` and the created device; post-create verified by refetching and confirming name + type match.
- `get_quickapp_available_types` — list the QuickApp device types this firmware knows about. Returns 32 `{type, label}` pairs on HC3 5.202.54. Use as the authoritative list when picking `type` for `create_quickapp` or validating plua `--%%type=...` headers. Wraps `GET /api/quickApp/availableTypes`.

### Changed
- `export_quickapp` description tightened to explain what encrypted export actually does: produces a .fqax locked to a list of HC3 serial numbers that are the only controllers permitted to import it. Useful for distributing a QA to specific third-party HC3 units without allowing further redistribution. No behaviour change.

## [2.2.2] - 2026-04-22

### Changed
- `modify_device` reject message for `properties.parameters` now (a) softens the "does not transmit" claim to match what we actually observed (in direct testing against a Zooz ZEN52 the cache updated, HC3 reported success, and the physical device's behaviour did not change — but HC3 5.x has no working REST path to verify whether any given write transmitted, so "does not reliably transmit" is the defensible claim, not "never transmits"), and (b) points callers at `get_device_parameters(deviceId)` for inspecting HC3's stored parameter values, labels, and formats without opening the Web UI.

## [2.2.1] - 2026-04-22

### Fixed
- `get_device_parameters` provenance wording was too pessimistic. Empirical check on an FGD212 dimmer showed multiple parameters whose values **differ** from their template `defaultValue` yet still carry `source: "template"` — so `"template"` does not mean "catalogue default returned as a placeholder" (the earlier framing). It means the value is from HC3's template-backed storage layer: what HC3 recorded the device as being configured to when the HC3 UI's native Z-Wave path wrote to it. In normal operation these values match the physical device; HC3 5.x just can't re-verify them over REST on demand. Revised the tool's description, the response `provenance_note` field, and renamed the response flag `all_values_are_template_defaults` → `all_values_are_hc3_stored` so callers know what the data actually is: "HC3's best knowledge of the device's configuration, almost certainly correct, not programmatically re-provable".

## [2.2.0] - 2026-04-22

### Added
- `get_device_parameters` — read a Z-Wave device's configuration parameters with human-readable labels and descriptions, sourced by merging `/api/zwave/configuration_parameters/{addr}` (current values) and `/api/zwave/parameters_templates/{addr}` (template catalogue). Returns per parameter: number, value, size, source provenance, label, description, default value, format. Honest about the HC3 5.x mesh-read limitation: every parameter carries a `source` field passed through verbatim from HC3; on current firmware the value is almost always `"template"` (catalogue default, not a physical-device read-back) because the mesh read-back path (`getParameter`, `reconfigure`, `pollConfigurationParameter`) is not-implemented or no-ops silently. A top-level `all_values_are_template_defaults` boolean flags when every returned value carries `source: "template"`, and a `provenance_warning` string explains what to trust. Live-tested against AEON MultiSensor 6, FGD212 Dimmer, and Zooz ZEN52. Parameter writes remain scoped out — `modify_device` still rejects `properties.parameters` per S14. Sources undocumented endpoints under `/api/zwave/*`.

## [2.1.1] - 2026-04-22

Bug-fix release covering two regressions surfaced immediately after the 2.1.0 tag was cut.

### Fixed
- `run_scene` / `stop_scene` were calling `/api/scenes/{id}/action/start` and `/action/stop`, which HC3 5.x rejects with `400 JSON_PARSE_ERROR: "The document is empty"`. The correct endpoints are `/api/scenes/{id}/execute` and `/api/scenes/{id}/kill` with a `{}` body. Both tools now use the correct paths.
- `set_global_variable` now reads the variable's current shape before writing and coerces the submitted value to match. Previously a boolean `true` on a string-valued global (e.g. the `isEnum` variable `isDark` with values `["false","true"]`) hit HC3's `deserializeJson error: types mismatch`. For `isEnum` globals the tool rejects values outside `enumValues` at the tool boundary (case-sensitive, matching HC3 semantics); for non-enum globals the submitted value is coerced to the current value's JS type. Read-only system globals are rejected before the PUT, and the write is now post-write-verified.

## [2.1.0] - 2026-04-21

Additive release: four new diagnostic tools, hardened write paths, and safety fixes found by live probing against HC3 5.x. No breaking changes.

### Added
- `get_zwave_mesh_health` — aggregate mesh health from `/api/devices?interface=zwave`: dead/unconfigured counts, dead devices with node IDs and reasons, breakdowns by room and manufacturer. Documented endpoint.
- `get_zwave_node_diagnostics` — per-node Z-wave transmission counters (frame totals, outgoing failures, incoming CRC/S0/S2/TransportService/MultiChannel failure breakdown, nonce exchanges). Enriched with device name, room, and computed `outgoingFailedPercent`; optional `min_outgoing_failed_percent` and `sort_by` filters. Sources the undocumented `/api/zwave/nodes/diagnostics/transmissions` (read-only).
- `get_zwave_reconfiguration_tasks` — active Z-wave reconfiguration tasks with status, target device and node, soft-vs-full flag, and child-device summary. Sources the undocumented `/api/zwaveReconfigurationTasks` (read-only).
- `get_event_history` — HC3 system event feed (scene starts, device property changes, device actions) — the data behind `/app/history`. Supports `limit` (capped at 1000 to prevent HC3 timeouts), `event_type` (case-sensitive exact match), `object_id` + `object_type`, and `since_timestamp` (filtered client-side because HC3 silently ignores the server-side `timestamp` param).

### Fixed
- **Write-path verification gaps** closed on every non-trivial mutating tool that was previously PUT-without-compare:
  - `modify_scene` now calls `verifyWrite` on the refetched scene — a silently-dropped field (like the class seen on Z-wave `properties.parameters`) no longer reports success.
  - `update_quickapp_file` refetches and byte-compares content after PUT.
  - `update_multiple_quickapp_files` does parallel per-file refetches (the `/files` list endpoint omits content; individual GETs required) and per-file content compare. Partial bulk-write failures now surface.
  - `create_quickapp_file` refetches by name after POST and verifies presence + content match.
  - `set_home_status` adds a runtime enum guard (`Home`/`Away`/`Night`/`Vacation`) — the schema advertised the enum but the handler trusted the caller.
  - `set_global_variable` URL-encodes `varName` path segment for consistency with every other user-supplied path component.
- `modify_device` now rejects `properties.parameters`, `properties.associations`, and `properties.multichannelAssociations` at the tool boundary. HC3 5.x caches these values and reports success but does not transmit them over the Z-wave mesh, producing a misleading "updated" state — the physical device keeps behaving on the old configuration. Matches the dedicated `getParameter`/`setParameter` action endpoints, which return "not implemented" on this firmware.
- `makeApiRequest` now throws when HC3 returns the JSON-RPC failure envelope (`{jsonrpc, error: {code, message}}`) on an HTTP 2xx action POST. Previously failures like "not implemented" passed through as success. Affects every action-POST path (devices, scenes, alarms, sprinklers, plugins).
- `control_device` pre-checks the requested action against `device.actions` and rejects unknown actions with the valid-action list. HC3 returns HTTP 404 for unknown actions on Z-wave devices but silently accepts anything on a QuickApp (actions route to the Lua `onAction` handler which dead-drops if unhandled). Soft-skips the check when `actions` is empty so QAs with dynamic action handling still pass through.
- `get_event_history` no longer claims to filter by `since_timestamp` server-side (HC3 silently ignores the timestamp query param) — filter is now applied client-side after fetch.
- `get_event_history` caps `limit` at 1000 client-side. HC3 has no server-side cap; a naive `limit=100000` used to time the MCP request out.
- URL-encode defensive fixes on `control_device` action name and `call_ui_event` event type, matching the pattern already in place on every other user-supplied path segment.
- Composite read tools (`get_system_context`, `get_device_relationships`, `get_automation_suggestions`, `explain_device_capabilities`) no longer swallow HC3 errors on their primary fetches. Ancillary fetches (weather, info) still go through a tolerant helper.
- Read-tool schemas no longer advertise `interval` / `includeExamples` flags that their handlers ignored.

## [2.0.0] - 2026-04-19

This is the first release from the [northernRough/HC3_mcp](https://github.com/northernRough/HC3_mcp) fork, which is now the actively maintained line. The upstream author moved to a different QuickApp development workflow (skills + plua) and greenlit the fork. Thanks to [jgab](https://github.com/jangabrielsson) for the original implementation.

### Breaking changes
- `update_climate_zone` parameter shape: `settings: any` replaced with `topLevel` / `properties` split. Callers must migrate.
- `update_location_settings` parameter shape: `settings: any` replaced with `locationId` + `fields` pair. Callers must migrate.
- `control_device` now rejects `action: "setVariable"` at the tool boundary. Callers must use `set_quickapp_variable` instead (type-aware, verified PUT). Prevents silent corruption of string-typed QuickApp variables.
- `modify_device` now rejects `properties.quickAppVariables` submissions. Callers must use `set_quickapp_variable` for QuickApp variable writes. Prevents silent wipe of unsubmitted variables.
- Tools removed as broken or fabricated: `get_quickapp_logs` (endpoint doesn't exist), `get_device_usage_patterns` (returned `Math.random()` output).

### Added
- `modify_scene` — update scene top-level metadata (name, icon, roomId, etc.).
- `update_scene_content` — replace Lua actions/conditions on a scene.
- `get_quickapp_variable` / `set_quickapp_variable` — single-variable read/write with declared-type coercion and verified PUT.
- Client-side filtering on `get_debug_messages` (tagContains, since, type, summary object).

### Fixed
- **Write guardrails** on every non-trivial write tool: read-modify-write semantics, post-write verification via refetch + field-by-field comparison, clear mismatch errors instead of silent "updated successfully".
  - `modify_device`: topLevel/properties split, rejects `quickAppVariables`, verifies writes.
  - `update_climate_zone`: topLevel/properties split, read-modify-write deep-merge on nested schedule objects, verifies writes. Prevents partial submissions wiping weekly schedules, device lists, or temperature sensors.
  - `update_location_settings`: locationId/fields, read-modify-write, verifies writes. Rejects read-only fields (`id`, `created`, `modified`).
  - `update_multiple_quickapp_files`: preserves `isMain` flag per file instead of hardcoding `false`.
- Shared `deepEqual`, `deepMerge`, `verifyWrite` helpers extracted for consistent write-path behaviour.
- Numerous camelCase vs snake_case mismatches between tool schemas and handlers, including fixes that made `explain_device_capabilities` and `get_device_relationships`'s `deviceId` filter actually work.
- `makeApiRequest` no longer crashes on empty response bodies (DELETE, restart, some PUTs).
- `makeApiRequest` 15-second timeout via `AbortSignal.timeout`.
- `makeApiRequest` surfaces HC3 error body detail instead of discarding it.
- MCP protocol version bumped to `"2024-11-05"`.
- `notifications/initialized` handled silently (no error response with undefined id).
- `ping`, `resources/list`, `prompts/list` handlers added (were returning "Method not found").
- `update_device_property` description now flags the endpoint as undocumented and points callers at `modify_device`.
- `axios` devDependency removed (never used).
- Accurate README tool list (83 tools grouped as the code organises them), correct tool count, CHANGELOG-linked release notes.
- Numerous lying schemas corrected (non-functional filter flags removed from tool schemas).

## [1.0.3] - 2025-08-19

### Fixed
- Fixed MCP server registration with GitHub Copilot after extension renaming
- Restored "*" activation event for proper early MCP server discovery
- Fixed TypeScript compilation errors in automation suggestions
- Updated provider ID to maintain compatibility

### Added
- New command "Configure GitHub Copilot MCP" for easier setup
- Enhanced debugging logs for MCP server resolution
- Documentation updates with troubleshooting notes

### Changed
- Improved README with session refresh instructions
- Updated MCP configuration guide with troubleshooting steps

## [1.0.2] - 2025-08-19

### Fixed
- Replaced placeholder icon with professional HC3-themed icon
- Improved performance by removing star activation warning

## [1.0.1] - 2025-08-19

### Fixed
- Added proper icon for VS Code marketplace

## [1.0.0] - 2025-08-19

### Added
- Initial release with 66+ MCP tools for Fibaro HC3 integration
- Complete REST API coverage for devices, scenes, variables, and system management
- QuickApp development tools with file manipulation capabilities
- Plugin management with UI interaction and lifecycle control
- Intelligent automation suggestions and device relationship analysis
- Built-in HC3 programming documentation and examples
- Support for both VS Code settings and environment variable configuration