# VS Code MCP Configuration Guide

## Configure GitHub Copilot to Use HC3 MCP Server

1. **In the Extension Development Host window**, open User Settings (JSON):
   - Press `Cmd+Shift+P`
   - Type "Preferences: Open User Settings (JSON)"
   - Select it

2. **Add this configuration** (replace `your_actual_password` with your HC3 password):

```json
{
  "github.copilot.chat.experimental.mcpServers": {
    "hc3-smart-home": {
      "command": "node",
      "args": ["/Users/jangabrielsson/Documents/dev/HC3_mcp/out/mcp/hc3-mcp-server.js"],
      "env": {
        "FIBARO_HOST": "192.168.1.57",
        "FIBARO_USERNAME": "admin",
        "FIBARO_PASSWORD": "your_actual_password",
        "FIBARO_PORT": "80"
      }
    }
  }
}
```

3. **Save the settings file** and **restart the Extension Development Host window**

4. **Test in Copilot Chat** with:
   - **Important**: Start a new chat session after extension setup
   - "List my HC3 devices"
   - "What smart home devices do I have?"
   - "@hc3-smart-home get all devices"

**Troubleshooting**: If tools aren't available, start a new GitHub Copilot chat session.

## Alternative: Test with Claude Desktop

If you have Claude Desktop installed, you can test there too:

1. **Edit** `~/Library/Application Support/Claude/claude_desktop_config.json`
2. **Add** the same configuration but under `"mcpServers"` instead
3. **Restart Claude Desktop**

## Troubleshooting

- Make sure the path to `hc3-mcp-server.js` is correct
- Replace the password with your actual HC3 password
- Ensure your HC3 system is accessible at 192.168.1.57
