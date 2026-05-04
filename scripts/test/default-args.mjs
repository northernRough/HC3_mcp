// Default arguments for read-only tools, keyed by tool name.
// Fixtures point at known-good entities on this HC3 (10.0.1.3):
//   - QA 4742 = roomManager (modular file structure with 18 files)
//   - Scene 670 = roomManager Heartbeat Watchdog
//   - Scene 645 = Watering (production scene with cron triggers)
//   - Device 4742 = roomManager QA device
//   - Device 2370 = a known FGRGBW442CC controller (child of 2367)
//   - Room 367 = Default Room (where scenes live)
//   - Global RoomMgrHeartbeat = numeric, refreshed every 60s

export const FIXTURES = {
    qa: 4742,
    sceneCron: 645,
    sceneSimple: 670,
    device: 4742,
    deviceChild: 2370,
    deviceParent: 2367,
    room: 367,
    globalVar: 'RoomMgrHeartbeat',
    parentName: 'Ben 12V device',
    deviceName: 'roomManager',
};

export function defaultArgsFor(toolName) {
    const f = FIXTURES;
    const map = {
        // device-id arg
        get_device_info:        { deviceId: f.device },
        get_device_property:    { deviceId: f.deviceChild, propertyName: 'value' },
        get_device_parameters:  { deviceId: f.deviceChild },
        get_device_relationships: { deviceId: f.device },
        get_devices:            { visible: true },
        filter_devices:         { filters: [{ filter: 'visible', value: [true] }], attributes: ['id', 'name'] },
        find_devices_by_name:   { name: f.deviceName },
        find_device_by_endpoint: { parentId: f.deviceParent, endpointId: 1 },
        explain_device_capabilities: { deviceId: f.device },
        // scene
        get_scenes:             {},
        // room
        get_rooms:              {},
        get_room:               { roomId: f.room },
        // global
        get_global_variables:   {},
        // qa / quickapp
        get_quickapp:           { quickAppId: f.qa },
        get_quickapps:          {},
        list_quickapp_files:    { deviceId: f.qa },
        get_quickapp_file:      { deviceId: f.qa, fileName: 'main' },
        get_quickapp_variable:  { deviceId: f.qa, variableName: 'binderMode' },
        get_quickapp_available_types: {},
        // system / diagnostics
        get_system_info:        {},
        get_system_context:     {},
        get_diagnostics:        {},
        get_network_status:     {},
        get_location_info:      {},
        get_home_status:        {},
        get_weather:            {},
        get_users:              {},
        get_ios_devices:        {},
        get_ip_cameras:         {},
        get_refresh_states:     {},
        // climate / energy
        get_climate_zones:      {},
        get_energy_data:        {},
        // alarm
        get_alarm_partitions:   {},
        get_alarm_devices:      {},
        get_alarm_history:      {},
        // notifications
        get_notifications:      {},
        // profile
        get_profiles:           {},
        // events
        get_event_history:      {},
        get_custom_events:      {},
        // backup
        get_backups:            {},
        can_create_backup:      {},
        get_local_backup_status: {},
        get_remote_backup_status: {},
        // plugins
        get_plugins:            {},
        get_installed_plugins:  {},
        get_plugin_types:       {},
        // sprinkler
        get_sprinkler_systems:  {},
        // z-wave / diagnostics
        get_zwave_mesh_health:  {},
        get_zwave_node_diagnostics: {},
        get_zwave_reconfiguration_tasks: {},
        // icons
        list_icons:             {},
        // debug
        get_debug_messages:     {},
        // hc3 doc / guide tools (no args)
        get_hc3_configuration_guide: {},
        get_hc3_lua_scenes_guide: {},
        get_hc3_programming_examples: {},
        get_hc3_quickapp_programming_guide: {},
        // New in 4.x — bind() pattern support tools
        audit_id_references:    { deviceId: f.device },
        audit_qa_devices:       { deviceId: f.qa },
        introspect_device_group: { deviceId: f.qa, groupPath: 'Devices.Ben.ensuiteRGBW', outputFormat: 'json' },
        // snapshot
        snapshot:               {},
    };
    return map[toolName] || null;
}
