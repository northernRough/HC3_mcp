# Change Log

All notable changes to the "hc3-mcp-server" extension will be documented in this file.

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