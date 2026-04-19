# Change Log

All notable changes to the "hc3-mcp-server" extension will be documented in this file.

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