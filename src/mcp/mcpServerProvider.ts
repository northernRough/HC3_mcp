import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface HC3McpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string | number | null>;
  version?: string;
}

interface EnvConfig {
  HC3_URL?: string;
  HC3_USER?: string;
  HC3_PASSWORD?: string;
}

export class HC3McpServerProvider implements vscode.McpServerDefinitionProvider {
  private _onDidChangeMcpServerDefinitions = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChangeMcpServerDefinitions.event;

  constructor(private context: vscode.ExtensionContext) {
    console.log('🏗️ HC3McpServerProvider constructor called');
    
    // Test the configuration immediately
    setTimeout(() => {
      console.log('🧪 Testing configuration on startup...');
      const config = this.getConnectionConfig();
      console.log('🧪 Startup config test:', { 
        hasHost: !!config.host, 
        hasUsername: !!config.username, 
        hasPassword: !!config.password,
        port: config.port
      });
    }, 1000);
  }

  private loadEnvFile(): EnvConfig {
    const envPath = path.join(os.homedir(), '.env');
    const envConfig: EnvConfig = {};

    try {
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        
        // Simple .env parser (basic implementation)
        envContent.split('\n').forEach(line => {
          const trimmedLine = line.trim();
          if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0) {
              const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
              if (key === 'HC3_URL' || key === 'HC3_USER' || key === 'HC3_PASSWORD') {
                envConfig[key as keyof EnvConfig] = value;
              }
            }
          }
        });
      }
    } catch (error) {
      console.warn('Failed to read .env file:', error);
    }

    return envConfig;
  }

  private getConnectionConfig(): { host?: string; username?: string; password?: string; port?: number } {
    console.log('🔧 Getting connection config...');
    const config = vscode.workspace.getConfiguration('hc3McpServer');
    
    // Try VS Code settings first
    let host = config.get<string>('host');
    let username = config.get<string>('username');
    let password = config.get<string>('password');
    const port = config.get<number>('port', 80);

    console.log('🔧 VS Code settings:', { host: host || 'undefined', username: username || 'undefined', password: password ? '***' : 'undefined', port });

    // If VS Code settings are incomplete, try environment variables
    if (!host || !username || !password) {
      console.log('🔧 VS Code settings incomplete, trying .env file...');
      const envConfig = this.loadEnvFile();
      console.log('🔧 .env config loaded:', { HC3_URL: envConfig.HC3_URL || 'undefined', HC3_USER: envConfig.HC3_USER || 'undefined', HC3_PASSWORD: envConfig.HC3_PASSWORD ? '***' : 'undefined' });
      
      // Use env variables as fallback
      if (!host && envConfig.HC3_URL) {
        // Extract host from URL if provided
        try {
          const url = new URL(envConfig.HC3_URL.startsWith('http') ? envConfig.HC3_URL : `http://${envConfig.HC3_URL}`);
          host = url.hostname;
          console.log('🔧 Extracted host from HC3_URL:', host);
        } catch {
          host = envConfig.HC3_URL;
          console.log('🔧 Using HC3_URL directly as host:', host);
        }
      }
      
      if (!username && envConfig.HC3_USER) {
        username = envConfig.HC3_USER;
        console.log('🔧 Using HC3_USER as username');
      }
      
      if (!password && envConfig.HC3_PASSWORD) {
        password = envConfig.HC3_PASSWORD;
        console.log('🔧 Using HC3_PASSWORD as password');
      }
    }

    const result = { host, username, password, port };
    console.log('🔧 Final connection config:', { host: host || 'undefined', username: username || 'undefined', password: password ? '***' : 'undefined', port });
    return result;
  }

  async provideMcpServerDefinitions(
    token: vscode.CancellationToken
  ): Promise<vscode.McpStdioServerDefinition[]> {
    try {
      console.log('🔍 provideMcpServerDefinitions called');
      
      // Check if MCP server script exists
      const serverScriptPath = vscode.Uri.joinPath(
        this.context.extensionUri,
        'out',
        'mcp',
        'fibaro-mcp-server.js'
      );

      try {
        await vscode.workspace.fs.stat(serverScriptPath);
        console.log('✅ MCP server script exists at:', serverScriptPath.fsPath);
      } catch (error) {
        console.log('❌ Server script doesn\'t exist at:', serverScriptPath.fsPath);
        console.log('❌ Error:', error);
        // Server script doesn't exist yet
        return [];
      }

      console.log('🔍 About to get connection config...');
      const { host, username, password, port } = this.getConnectionConfig();
      console.log('✅ Got connection config');

      if (!host || !username || !password) {
        console.log('❌ Configuration incomplete - returning empty array');
        console.log('❌ Missing:', { host: !host, username: !username, password: !password });
        // Configuration incomplete
        return [];
      }

      console.log('✅ Creating MCP server definition');
      const serverDefinition = new vscode.McpStdioServerDefinition(
        'Fibaro HC3 Smart Home',
        'node',
        [serverScriptPath.fsPath],
        {
          FIBARO_HOST: host,
          FIBARO_USERNAME: username,
          FIBARO_PASSWORD: password,
          FIBARO_PORT: port?.toString() || '80',
        },
        '1.0.0'
      );

      console.log('🚀 Returning MCP server definition');
      return [serverDefinition];
    } catch (error) {
      console.error('❌ Error in provideMcpServerDefinitions:', error);
      return [];
    }
  }

  async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition,
    token: vscode.CancellationToken
  ): Promise<vscode.McpStdioServerDefinition> {
    // This is called when VS Code needs to start the MCP server
    // We can perform any authentication or validation here
    
    const { host, username, password } = this.getConnectionConfig();

    if (!host || !username || !password) {
      throw new Error('Fibaro HC3 configuration is incomplete. Please configure the extension settings or check your ~/.env file.');
    }

    // Test connection (optional)
    try {
      await this.testConnection(host, username, password);
    } catch (error) {
      throw new Error(`Failed to connect to Fibaro HC3: ${error instanceof Error ? error.message : String(error)}`);
    }

    return server;
  }

  private async testConnection(host: string, username: string, password: string): Promise<void> {
    // Simple connection test using built-in fetch
    const url = `http://${host}/api/settings/info`;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown connection error');
    }
  }

  refresh(): void {
    this._onDidChangeMcpServerDefinitions.fire();
  }
}
