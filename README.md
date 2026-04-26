# HC3 MCP Server

Standalone Model Context Protocol server giving Claude, Cursor, or any MCP client live, guard-railed access to a Fibaro Home Center 3.

> **Not to be confused with the unscoped `mcp-server-hc3` package on npm.** That package covers a smaller core surface (rooms, devices, scenes). This fork adds QuickApp file management, Z-Wave diagnostics, profile orchestration, custom events, alarm partitions, and 124+ tools total, with verified write guardrails on all destructive operations.

This is a community fork of [jangabrielsson/HC3_mcp](https://github.com/jangabrielsson/HC3_mcp). Upstream is no longer actively maintained; this fork is the canonical line. Credit to [jgab](https://github.com/jangabrielsson) for the original implementation.

## Install

```bash
npm install -g @northernrough/hc3-mcp-server
```

Or run directly with `npx` (no install):

```bash
npx @northernrough/hc3-mcp-server
```

## Configure

The server reads four environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `FIBARO_HOST` | yes | — | HC3 IP address or hostname (e.g. `192.168.1.57`) |
| `FIBARO_USERNAME` | yes | — | HC3 user (admin recommended for full surface) |
| `FIBARO_PASSWORD` | yes | — | HC3 password |
| `FIBARO_PORT` | no | `80` | HC3 port |

For development you can put these in a local `.env` file (the server uses `dotenv` automatically).

## Wire into your MCP client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "hc3": {
      "command": "npx",
      "args": ["-y", "@northernrough/hc3-mcp-server"],
      "env": {
        "FIBARO_HOST": "192.168.1.57",
        "FIBARO_USERNAME": "admin",
        "FIBARO_PASSWORD": "your_password"
      }
    }
  }
}
```

Restart Claude Desktop. The HC3 tools appear in the tools menu.

### Claude Code

```bash
claude mcp add hc3 -- npx -y @northernrough/hc3-mcp-server \
  --env FIBARO_HOST=192.168.1.57 \
  --env FIBARO_USERNAME=admin \
  --env FIBARO_PASSWORD=your_password
```

### Cursor / Cline / Continue

Each client uses a similar JSON shape; consult its docs for the config file location. The shape is the same as Claude Desktop's:

```json
{
  "mcpServers": {
    "hc3": {
      "command": "npx",
      "args": ["-y", "@northernrough/hc3-mcp-server"],
      "env": {
        "FIBARO_HOST": "192.168.1.57",
        "FIBARO_USERNAME": "admin",
        "FIBARO_PASSWORD": "your_password"
      }
    }
  }
}
```

## What this does

This server exposes 124+ tools spanning the full HC3 read and write surface, with write guardrails on every destructive operation. Every mutating tool reads the target first, deep-merges the submitted change, writes, refetches, and asserts the change took effect. If HC3 silently dropped or normalised a field, the tool throws rather than reporting a misleading success.

A condensed summary follows. See the live `tools/list` from the running server (or expand each section below) for the authoritative list.

<details>
<summary><strong>Available Tools</strong> (121+)</summary>

### Devices and Rooms
- `get_devices` - List devices, with filters for type, room, interface, visibility, and more
- `get_device_info` - Get a single device by ID
- `filter_devices` - Server-side multi-criteria filter with attribute projection (POST /api/devices/filter). Much smaller payloads than get_devices when you know which fields you need
- `find_devices_by_name` - Resolve a name to parent/top-level devices (substring / exact, optional roomId and visibleOnly filters). Trimmed record output — much smaller than get_devices for lookup workflows
- `find_device_by_endpoint` - Resolve a multi-endpoint child device by (parentId, endpointId). Stable identity for children that survives Z-Wave re-inclusion. Returns an array — endpoint 0 is commonly ambiguous
- `get_device_property` - Read a single device property (much smaller than get_device_info for scalar fields)
- `cancel_delayed_action` - Cancel a queued delayed device action by (deviceId, timestamp)
- `delete_device` - Delete a single device by id. Refuses ids <10, Z-Wave physical devices (without allow_physical), and devices with children (without cascade). Post-delete verified
- `control_device` - Invoke device actions (turnOn, turnOff, setValue, setColor, etc.)
- `modify_device` - Edit top-level fields (name, roomID, enabled, visible) and nested properties in a single verified PUT
- `get_rooms` - List rooms and sections
- `get_room` - Get a single room by id
- `create_room` - Create a new room (pre-validates 20-char name limit)
- `modify_room` - Update a room via read-modify-write + verify
- `delete_room` - Delete a room, with guards for the default room and rooms with devices (reassign_to target)
- `assign_devices_to_room` - Batch-move devices to a room (groupAssignment), with per-device post-move verify

### Scenes
- `get_scenes` - List scenes with filters
- `run_scene` - Start a scene (async, returns immediately)
- `run_scene_sync` - Run a scene synchronously, waiting for completion. Useful for sequenced automation steps
- `stop_scene` - Stop a running scene
- `modify_scene` - Update scene metadata (name, icon, room, etc.)
- `create_scene` - Create a new scene (with HC3-required field defaults; post-create verify)
- `update_scene_content` - Replace scene Lua (actions/conditions) content

### Icons
- `list_icons` - List all icons HC3 knows about, grouped by device/room/scene
- `get_icon` - Fetch an icon's binary content base64-encoded; detects HC3's silent SVG-fallback for missing icons
- `delete_icon` - Delete a user-uploaded icon. Built-in icons return 403

### System
- `get_system_info` - HC3 version, serial, and system details
- `snapshot` - Single-call dump of every mutable HC3 configuration surface (devices, rooms, scenes, QAs with files, globals, custom events, alarm, climate, system, users, HC3 API docs) for backup regimes and drift detection. Per-surface atomicity; opt-in zwave-parameters surface
- `get_network_status` - Network connectivity status
- `get_energy_data` - Energy consumption data
- `get_diagnostics` - System health diagnostics
- `get_weather` - Current weather data
- `get_home_status` - Current home mode
- `set_home_status` - Set home mode (Home/Away/Vacation/Night)
- `get_profiles` - List HC3 profiles + activeProfile id (Home/Away/Vacation orchestration)
- `get_profile` - Get one profile's detail (devices/scenes/climateZones/partitions)
- `activate_profile` - Switch the active profile with post-activation verify
- `modify_profile` - Update a profile (name/icon/devices/scenes/climateZones/partitions) with read-modify-write + verify
- `create_profile` - Create a new profile (post-create verify)
- `delete_profile` - Delete a profile (refuses the active one; post-delete verify)
- `reset_profiles` - DESTRUCTIVE: resets every profile to HC3 defaults. Requires explicit confirm=true
- `set_profile_scene_action` - Set how a profile handles a specific scene on activation
- `set_profile_climate_zone_action` - Set how a profile handles a specific climate zone on activation
- `set_profile_partition_action` - Set how a profile handles a specific alarm partition on activation
- `get_location_info` - Home location settings
- `update_location_settings` - Update location, timezone, and related settings

### Global Variables
- `get_global_variables` - List all global variables
- `set_global_variable` - Update an existing global variable (type-coerced to the stored type)
- `create_global_variable` - Create a new global variable (refuses if name exists; validates name regex; supports isEnum with enumValues)
- `delete_global_variable` - Delete a global variable by name. Reads lastValue first (returned as recovery trail); refuses readOnly system globals unless allow_system=true. Post-delete verified

### Users
- `get_users` - List users and permissions
- `update_user_rights` - Modify a user's access rights (devices, scenes, climateZones, profiles, alarmPartitions). Read-modify-write + post-write-verify. Safety guards against writing rights.advanced (privilege escalation) or setting rights.*.all=true (mass grant) unless explicitly overridden; refuses superuser targets

### Climate
- `get_climate_zones` - List climate zones
- `get_climate_zone` - Get a single climate zone
- `update_climate_zone` - Update climate zone settings

### Alarm
- `get_alarm_partitions` - List alarm partitions
- `get_alarm_partition` - Get a single alarm partition
- `arm_alarm_partition` - Arm a partition
- `disarm_alarm_partition` - Disarm a partition
- `get_alarm_history` - Alarm event history
- `get_alarm_devices` - Security devices

### Sprinklers
- `get_sprinkler_systems` - List sprinkler systems
- `get_sprinkler_system` - Get a single sprinkler system
- `control_sprinkler_system` - Start/stop irrigation with duration and delay

### Custom Events
- `get_custom_events` - List custom event definitions
- `create_custom_event` - Create a new custom event
- `trigger_custom_event` - Emit a custom event
- `get_custom_event` - Read a single custom event by name
- `update_custom_event` - Update userDescription and/or rename (read-modify-write)
- `delete_custom_event` - Delete by name (captures last userDescription)

### Notifications
- `get_notifications` - List notifications
- `mark_notification_read` - Mark a notification read
- `clear_all_notifications` - Clear all notifications
- `get_notification` - Read a single notification by id
- `update_notification` - Update notification fields (wasRead, data, priority) with read-modify-write
- `delete_notification` - Delete by id, capturing last data as recovery trail. Refuses canBeDeleted=false unless allow_system=true

### Backups
- `can_create_backup` - Check whether backups can be created
- `get_local_backup_status` - Local backup status
- `get_remote_backup_status` - Remote backup status
- `get_backups` - List backups
- `create_backup` - Create a new backup

### iOS Devices
- `get_ios_devices` - List registered iOS devices
- `register_ios_device` - Register a new iOS device

### Debug
- `get_debug_messages` - Retrieve debug messages with client-side filtering
- `clear_debug_messages` - Clear all debug messages (returns count cleared). Useful for test loops

### System Events
- `get_event_history` - HC3 system event feed (scene starts, device property changes, device actions) — the data behind /app/history. Supports event_type, object_id/object_type, since_timestamp (client-side) and limit (capped at 1000).
- `get_refresh_states` - Live poll of HC3's native event/state-change stream (GET /api/refreshStates?last=cursor). Returns changes (state deltas) + events + new cursor. Complementary to get_event_history — refreshStates is live, event_history is retrospective

### Z-Wave Diagnostics
- `get_zwave_mesh_health` - Aggregate mesh health from /api/devices?interface=zwave: dead/unconfigured counts, dead devices with node IDs and reasons, breakdowns by room and manufacturer
- `get_zwave_node_diagnostics` - Per-node Z-wave transmission counters (frame totals, outgoing failures, CRC/S0/S2/TransportService/MultiChannel failures, nonce exchanges) enriched with device name, room, and computed outgoing-failed percent. Sources an undocumented endpoint
- `get_zwave_reconfiguration_tasks` - Active reconfiguration tasks with status, target device and node, child-device summary. Sources an undocumented endpoint
- `get_device_parameters` - Z-Wave device configuration parameters with human-readable labels, descriptions, defaults, and format. Merges current values with the template catalogue. Flags provenance honestly: on HC3 5.x the mesh read-back path does not work, so most values are template defaults rather than live device readings

### QuickApps
- `get_quickapps` - List QuickApps
- `get_quickapp` - Get a single QuickApp
- `create_quickapp` - Create a new empty QuickApp on HC3 from scratch (not from a .fqa file; use import_quickapp for that)
- `get_quickapp_available_types` - List the QuickApp device types the current firmware accepts, for picking a `type` when calling create_quickapp
- `restart_quickapp` - Restart a QuickApp
- `get_quickapp_variable` - Read a single quickAppVariable
- `set_quickapp_variable` - Write a single quickAppVariable

### QuickApp File Management
- `list_quickapp_files` - List source files for a QuickApp
- `get_quickapp_file` - Get a single file's content
- `create_quickapp_file` - Create a new source file
- `update_quickapp_file` - Update an existing source file
- `update_multiple_quickapp_files` - Batch update multiple files
- `delete_quickapp_file` - Delete a source file (main files cannot be deleted)
- `export_quickapp` - Export as .fqa (open) or .fqax (encrypted)
- `import_quickapp` - Import from .fqa/.fqax

### System Intelligence and Context
- `get_system_context` - Comprehensive system overview
- `get_device_relationships` - Device relationships and room assignments
- `get_automation_suggestions` - Automation recommendations
- `explain_device_capabilities` - Detailed capability explanations

### HC3 Programming Documentation
- `get_hc3_configuration_guide` - HC3 configuration reference
- `get_hc3_quickapp_programming_guide` - QuickApp programming guide
- `get_hc3_lua_scenes_guide` - Lua scenes programming guide
- `get_hc3_programming_examples` - Code examples and snippets

### Plugin Management
- `get_plugins` - All plugins (installed plus available)
- `get_installed_plugins` - Installed plugins
- `get_plugin_types` - Plugin type catalogue
- `get_plugin_view` - Plugin view/configuration interface
- `update_plugin_view` - Update plugin view components
- `call_ui_event` - Trigger UI events on plugin interface elements
- `create_child_device` - Create child devices
- `manage_plugin_interfaces` - Add or remove interfaces from devices
- `restart_plugin` - Restart a plugin
- `update_device_property` - Update device property values directly
- `publish_plugin_event` - Publish system events through the plugin system
- `get_ip_cameras` - Available IP camera types
- `install_plugin` - Install a plugin
- `delete_plugin` - Uninstall a plugin

</details>

Each tool includes input validation, error handling, and detailed response data to help AI assistants understand and work with your Fibaro HC3 system effectively.

## Why this fork

[Upstream](https://github.com/jangabrielsson/HC3_mcp) was a starting point, not a maintained product. The original author has moved on to a different QuickApp development workflow (his `plua` repo + skills) and has greenlit this fork for independent evolution. Significant work that lives only in this fork:

- **Write guardrails on every mutating tool.** Read-modify-write, post-write verify, refetch-and-compare on every destructive endpoint. Catches HC3's known silent-drop classes (e.g. Z-Wave parameter writes that cache without transmitting; QA file writes that need byte-exact verification; user-rights writes that would 403 if the full record is echoed back). See `CHANGELOG.md` for the inventory of caught classes.
- **Z-Wave diagnostics** that don't exist in upstream: `get_zwave_mesh_health`, `get_zwave_node_diagnostics` (per-node frame/CRC/security counters), `get_zwave_reconfiguration_tasks`, `get_device_parameters` (with honest provenance — values are HC3-stored, not live device readings on this firmware).
- **Resilient name → id resolution** for manifest-driven sync that survives Z-Wave re-inclusion (`find_devices_by_name`, `find_device_by_endpoint`).
- **Profile orchestration** end-to-end (read, activate, modify, full CRUD, association PUTs).
- **Snapshot tool** for nightly backup regimes — single-call dump of every mutable surface with per-surface atomicity.
- **Standalone**, no dependency on plua or any local development toolchain. Works out of the box with `npx`.

If you are happy on a smaller core surface, the unscoped `mcp-server-hc3` may suit you better. If you maintain a household HC3 with QuickApps, scenes, and Z-Wave actors and want the agent to be able to do meaningful, safe work over the full system, this fork is what you want.

## Security

This server runs with your HC3 admin credentials and exposes write access to your home: devices, scenes, QuickApps, global variables, profiles, users, rooms, alarm partitions, and the notification centre. Any MCP client (Claude Code, Claude Desktop, Cursor, Cline, etc.) connected to it can read and mutate that state. Treat the credentials and the agent's prompts accordingly.

- Credentials are taken from environment variables (`FIBARO_HOST`, `FIBARO_USERNAME`, `FIBARO_PASSWORD`, optional `FIBARO_PORT`). They are never written to disk by this code.
- The published npm tarball contains only compiled JS, `LICENSE`, `README.md`, `CHANGELOG.md`, and `SECURITY.md`. No `.env`, no local configuration files.
- HC3 does not currently expose TLS on its REST surface; the credential transit is HTTP Basic auth. Run this on the same trusted network as the HC3, or front it with a reverse proxy.

To report a vulnerability, see [SECURITY.md](SECURITY.md). Please email rather than file a public issue.

## Maintenance

This package is maintained for the author's personal HC3 setup and is published as-is for the wider Fibaro community. There is no SLA. Issues and PRs are welcome; response time is best-effort. Stable interfaces are SemVer-respected — patch releases are bug fixes, minors are additive, majors are breaking. Subscribe to GitHub releases on `northernRough/HC3_mcp` to track new versions.

## Known issues

- IPv6 addresses are not supported
- TLS to the HC3 requires a fronting reverse proxy (HC3 firmware is HTTP-only on the REST surface)
- Some advanced HC3 features (notification centre creation, certain Z-Wave write paths) are firmware-quirky on 5.x; tools that hit those quirks fail loudly rather than silently and document the boundary in their tool descriptions

## Contributing

Pull requests are welcome. The repo follows a strict branch-per-logical-change convention with read-modify-write + post-write verify on every mutating tool. See `~/code/hc3/HC3_mcp/CLAUDE.md` (in the local checkout) for the workflow expectations.

## License

[MIT License](LICENSE). Original work copyright (c) 2024 GsonSoft Development; fork modifications and additions copyright (c) 2026 northernRough.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).
