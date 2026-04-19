# HC3 MCP Server

A VS Code extension that provides Model Context Protocol (MCP) server integration for Fibaro Home Center 3 (HC3) smart home systems. This extension allows AI assistants in VS Code to interact with your Fibaro HC3 devices, scenes, and system information through natural language commands.

## Features

- **Complete Fibaro HC3 REST API Integration**: Access all major HC3 endpoints
- **VS Code Extension Integration**: Seamlessly registers as an MCP server in VS Code
- **Configuration Management**: Easy setup via VS Code settings or environment variables
- **Comprehensive API Coverage**: 80+ tools covering all aspects of HC3 management
- **QuickApp Development**: Full file manipulation capabilities for QuickApp development
- **Plugin Management**: Complete plugin configuration, UI interaction, and lifecycle management
- **Intelligent Context**: System analysis, automation suggestions, and device relationships
- **Programming Documentation**: Built-in HC3 programming guides and examples
- **Error Handling**: Robust error handling with detailed error messages
- **Type Safety**: Full TypeScript implementation with proper types  

## Requirements

- **Fibaro Home Center 3**: A running HC3 system with network access
- **VS Code**: Version 1.103.0 or higher
- **Network Access**: Your VS Code environment must be able to reach your HC3 system
- **HC3 User Account**: Valid username and password for your HC3 system

## Installation & Setup

1. **Install the Extension**:
   - Install from VS Code Marketplace (coming soon)
   - Or install from `.vsix` file using `Extensions: Install from VSIX...` command

## Configuration

### Method 1: VS Code Settings (Recommended)

1. **Configure via Command Palette**:
   - Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
   - Run `HC3 MCP: Configure Fibaro HC3 Connection`
   - Follow the prompts to enter your HC3 details

2. **Manual Settings**:
   - Go to VS Code Settings
   - Search for "HC3 MCP"
   - Configure:
     - **Host**: IP address of your HC3 (e.g., `192.168.1.57`)
     - **Username**: Your HC3 username
     - **Password**: Your HC3 password
     - **Port**: HC3 port (default: 80)

### Method 2: Environment Variables (Fallback)

Create a `~/.env` file in your home directory with:

```bash
HC3_URL=http://192.168.1.57
HC3_USER=your_username
HC3_PASSWORD=your_password
```

**Note**: The extension will automatically use environment variables as fallback if VS Code settings are not configured.

### Testing Your Configuration

- Run `HC3 MCP: Test Fibaro HC3 Connection` command
- Verify successful connection to your HC3 system

## GitHub Copilot Configuration

For GitHub Copilot to use the MCP server, you need to configure it manually:

1. **Open User Settings (JSON)** in VS Code:
   - Press `Cmd+Shift+P` / `Ctrl+Shift+P`
   - Type "Preferences: Open User Settings (JSON)"

2. **Add MCP Server Configuration**:
```json
{
  "github.copilot.chat.experimental.mcpServers": {
    "hc3-smart-home": {
      "command": "node",
      "args": ["/path/to/your/extension/out/mcp/hc3-mcp-server.js"],
      "env": {
        "FIBARO_HOST": "192.168.1.57",
        "FIBARO_USERNAME": "admin",
        "FIBARO_PASSWORD": "your_password",
        "FIBARO_PORT": "80"
      }
    }
  }
}
```

3. **Replace the configuration values**:
   - Update the path to your compiled MCP server
   - Set your HC3 IP address, username, and password
   - Restart VS Code

4. **Test in Copilot Chat**:
   - **Important**: Start a new chat session after configuring the extension
   - "List my HC3 devices"
   - "@hc3-smart-home get all devices"

**Note**: If the MCP server tools are not immediately available, start a new GitHub Copilot chat session to allow it to discover the MCP server.

## Extension Settings

This extension contributes the following settings:

* `hc3McpServer.host`: Fibaro HC3 IP address or hostname
* `hc3McpServer.username`: Fibaro HC3 username
* `hc3McpServer.password`: Fibaro HC3 password (stored securely)
* `hc3McpServer.port`: Fibaro HC3 port number (default: 80)

## Usage

## Usage Examples

Once configured, the extension automatically provides an MCP server that AI assistants can use. You can interact with your HC3 system using natural language commands like:

### Basic Device Control
- "Show me all devices in the living room"
- "Turn on the kitchen lights"
- "Set the bedroom dimmer to 50%"
- "Turn off all lights in the house"

### Advanced Device Operations
- "Show me all Z-Wave devices"
- "Get detailed information about device 25"
- "Set the RGB light to blue color"
- "Turn on the garden sprinkler for 10 minutes with a 5-minute delay"

### Scene Management
- "List all scenes in the master bedroom"
- "Run the movie night scene"
- "Stop the current scene"
- "Show me all Alexa-enabled scenes"

### Energy Monitoring
- "Show energy consumption for device 15"
- "Get total energy usage for today"
- "Which devices are consuming the most power?"

### System Information
- "What's the current weather?"
- "Show HC3 system information"
- "What's the current home status?"
- "Set home mode to Away"

### Smart Home Automation
- "Create an automation to turn off all lights when I leave"
- "Show me all motion sensors and their current state"
- "What's the temperature in each room?"

### QuickApp Development
- "Show me the files for QuickApp 926"
- "Get the content of the main.lua file for device 145"
- "Create a new helper.lua file for QuickApp 82"
- "Update the main file for QuickApp 67 with new code"
- "Export QuickApp 45 as an encrypted file for specific gateways"
- "Delete the old_function.lua file from QuickApp 29"

### Plugin Management & Configuration
- "Show me all installed plugins"
- "Get the configuration interface for device 75"
- "Update the label text for button_1 on device 45"
- "Trigger the onReleased event for switch_main on device 33"
- "Create a child device for multi-channel switch 88"
- "Add energy interface to device 156"
- "Restart the malfunctioning plugin on device 92"
- "Update the temperature property for device 64"
- "Show available IP camera types for installation"

## Available Tools

The MCP server provides 80+ tools. Names below match the MCP tool names exactly.

### Devices and Rooms
- `get_devices` - List devices, with filters for type, room, interface, visibility, and more
- `get_device_info` - Get a single device by ID
- `control_device` - Invoke device actions (turnOn, turnOff, setValue, setColor, etc.)
- `modify_device` - Edit top-level fields (name, roomID, enabled, visible) and nested properties in a single verified PUT
- `get_rooms` - List rooms and sections

### Scenes
- `get_scenes` - List scenes with filters
- `run_scene` - Start a scene
- `stop_scene` - Stop a running scene
- `modify_scene` - Update scene metadata (name, icon, room, etc.)
- `update_scene_content` - Replace scene Lua (actions/conditions) content

### System
- `get_system_info` - HC3 version, serial, and system details
- `get_network_status` - Network connectivity status
- `get_energy_data` - Energy consumption data
- `get_diagnostics` - System health diagnostics
- `get_weather` - Current weather data
- `get_home_status` - Current home mode
- `set_home_status` - Set home mode (Home/Away/Vacation/Night)
- `get_location_info` - Home location settings
- `update_location_settings` - Update location, timezone, and related settings

### Global Variables
- `get_global_variables` - List all global variables
- `set_global_variable` - Create or update a global variable

### Users
- `get_users` - List users and permissions

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

### Notifications
- `get_notifications` - List notifications
- `mark_notification_read` - Mark a notification read
- `clear_all_notifications` - Clear all notifications

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

### QuickApps
- `get_quickapps` - List QuickApps
- `get_quickapp` - Get a single QuickApp
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

Each tool includes input validation, error handling, and detailed response data to help AI assistants understand and work with your Fibaro HC3 system effectively.

## Development

### Building from Source

```bash
# Clone the repository
git clone <repository-url>
cd hc3-mcp-server

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package the extension
npm run package
```

### Running in Development

1. Open the project in VS Code
2. Press `F5` to run the Extension Development Host
3. Test the extension in the new VS Code window

### Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## Security Considerations

- **Local Network**: This extension communicates with your HC3 system over your local network
- **Credentials**: Passwords are stored in VS Code's secure credential store
- **API Access**: The extension uses HC3's REST API with standard HTTP Basic Authentication
- **No Cloud**: All communication is direct between VS Code and your HC3 system

## Troubleshooting

### Connection Issues
1. **Verify HC3 System**: Ensure your HC3 is powered on and accessible on the network
2. **Check Network Settings**: Verify IP address, port, and network connectivity
3. **Test Credentials**: Ensure username/password are correct and user has API access
4. **Test Connection**: Use the "HC3 MCP: Test Fibaro HC3 Connection" command to verify settings

### Configuration Issues
1. **VS Code Settings**: Check that all required fields are filled in VS Code settings
2. **Environment Variables**: If using ~/.env, ensure the file exists and has correct format:
   ```bash
   HC3_URL=http://192.168.1.57
   HC3_USER=admin
   HC3_PASSWORD=your_password
   ```
3. **File Permissions**: Ensure ~/.env file is readable
4. **Restart Required**: Restart VS Code after changing ~/.env file

### MCP Server Issues
1. **Check Extension Activation**: Verify the extension is enabled and activated
2. **Check Output Panel**: Look for error messages in VS Code Developer Console
3. **Verify MCP Registration**: Ensure the MCP server appears in AI assistant settings
4. **Restart VS Code**: Sometimes a restart resolves registration issues

### Common Error Messages
- **"Fibaro HC3 not configured"**: Configure settings or check ~/.env file
- **"Connection refused"**: Check network connectivity and HC3 system status
- **"Authentication failed"**: Verify username and password
- **"HTTP 404"**: Check HC3 firmware version and API availability
- **"Configuration incomplete"**: Ensure all required settings are provided

## Known Issues

- IPv6 addresses are not yet supported
- HTTPS connections require additional configuration
- Some advanced device types may need specific action commands

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT License](LICENSE)

## Support

For issues and questions:
- [Fibaro Community](https://forum.fibaro.com/)

---

**Enjoy controlling your smart home with AI assistance!** 🏠🤖
