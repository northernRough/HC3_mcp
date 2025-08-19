// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { HC3McpServerProvider } from './mcp/mcpServerProvider.js';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use window.showInformationMessage for debugging since console.log might be filtered
	vscode.window.showInformationMessage('🚀 Extension STARTING (via popup)');
	console.log('🚀 Extension STARTING');
	
	// Show a notification immediately
	vscode.window.showInformationMessage('🎉 Extension activated! Commands should be available now.');

	// Register a simple command for testing
	console.log('🔧 Registering hello world command...');
	const helloWorldCommand = vscode.commands.registerCommand('hc3-mcp-server.helloWorld', () => {
		vscode.window.showInformationMessage('✅ Hello World command executed!');
		console.log('✅ Hello World command was executed');
	});
	context.subscriptions.push(helloWorldCommand);

	// Register configuration command
	console.log('🔧 Registering configuration command...');
	const configureCommand = vscode.commands.registerCommand('hc3-mcp-server.configure', async () => {
		await configureFibaroHc3();
	});
	context.subscriptions.push(configureCommand);

	// Register test connection command
	console.log('🔧 Registering test connection command...');
	const testConnectionCommand = vscode.commands.registerCommand('hc3-mcp-server.testConnection', async () => {
		await testFibaroConnection();
	});
	context.subscriptions.push(testConnectionCommand);

	// Register Copilot configuration helper command
	console.log('🔧 Registering Copilot configuration command...');
	const copilotConfigCommand = vscode.commands.registerCommand('hc3-mcp-server.configureCopilot', async () => {
		await configureCopilotMcp();
	});
	context.subscriptions.push(copilotConfigCommand);

	// Try to register MCP server provider if available
	console.log('🔧 Checking for MCP API availability...');
	console.log('VS Code version check - vscode.lm exists:', !!vscode.lm);
	console.log('VS Code version check - registerMcpServerDefinitionProvider exists:', !!(vscode.lm && vscode.lm.registerMcpServerDefinitionProvider));
	
	try {
		// Check if the MCP API is available
		if (vscode.lm && typeof vscode.lm.registerMcpServerDefinitionProvider === 'function') {
			console.log('✅ MCP API detected, registering MCP server provider...');
			
			try {
				console.log('✅ MCP provider module loaded');
				const mcpProvider = new HC3McpServerProvider(context);
				console.log('✅ MCP provider instance created');
				
				const mcpDisposable = vscode.lm.registerMcpServerDefinitionProvider(
					'fibaro-hc3-mcp.servers',
					mcpProvider
				);
				console.log('✅ MCP provider registered with ID: fibaro-hc3-mcp.servers');
				
				context.subscriptions.push(mcpDisposable);
				console.log('✅ MCP server provider registered successfully!');
				vscode.window.showInformationMessage('🤖 HC3 MCP server is now available for AI assistants!');
			} catch (error) {
				console.error('❌ Failed to load MCP provider:', error);
				vscode.window.showWarningMessage('MCP functionality failed to load, but basic commands are still available.');
			}
		} else {
			console.log('ℹ️ MCP API not available in this VS Code version.');
			console.log('Current VS Code version appears to be 1.103.1 - MCP API may require a newer version.');
			vscode.window.showInformationMessage('ℹ️ MCP functionality not available in this VS Code version. Basic commands are available.');
		}
	} catch (mcpError) {
		console.warn('MCP API check failed:', mcpError);
		vscode.window.showWarningMessage('MCP API check failed, but basic commands are still available.');
	}

	console.log('✅ Extension activation COMPLETE');
}

async function configureFibaroHc3(): Promise<void> {
	const config = vscode.workspace.getConfiguration('hc3McpServer');

	// Show info about environment variable fallback
	const useEnv = await vscode.window.showInformationMessage(
		'You can configure Fibaro HC3 through VS Code settings or by using environment variables in ~/.env file (HC3_URL, HC3_USER, HC3_PASSWORD). How would you like to configure?',
		'VS Code Settings',
		'Use ~/.env file',
		'Cancel'
	);

	if (useEnv === 'Cancel') {
		return;
	}

	if (useEnv === 'Use ~/.env file') {
		vscode.window.showInformationMessage(
			'Create a ~/.env file with:\nHC3_URL=http://192.168.1.57\nHC3_USER=your_username\nHC3_PASSWORD=your_password\n\nThen restart VS Code to apply the configuration.',
			'OK'
		);
		return;
	}

	// Get current values
	const currentHost = config.get<string>('host', '');
	const currentUsername = config.get<string>('username', '');
	const currentPort = config.get<number>('port', 80);

	// Prompt for host
	const host = await vscode.window.showInputBox({
		prompt: 'Enter Fibaro HC3 IP address or hostname (e.g., 192.168.1.57)',
		value: currentHost,
		validateInput: (value) => {
			if (!value.trim()) {
				return 'Host is required';
			}
			return null;
		}
	});

	if (!host) {
		return;
	}

	// Prompt for username
	const username = await vscode.window.showInputBox({
		prompt: 'Enter Fibaro HC3 username',
		value: currentUsername,
		validateInput: (value) => {
			if (!value.trim()) {
				return 'Username is required';
			}
			return null;
		}
	});

	if (!username) {
		return;
	}

	// Prompt for password
	const password = await vscode.window.showInputBox({
		prompt: 'Enter Fibaro HC3 password',
		password: true,
		validateInput: (value) => {
			if (!value.trim()) {
				return 'Password is required';
			}
			return null;
		}
	});

	if (!password) {
		return;
	}

	// Prompt for port (optional)
	const portStr = await vscode.window.showInputBox({
		prompt: 'Enter Fibaro HC3 port (default: 80)',
		value: currentPort.toString(),
		validateInput: (value) => {
			if (value.trim() && (isNaN(Number(value)) || Number(value) < 1 || Number(value) > 65535)) {
				return 'Port must be a number between 1 and 65535';
			}
			return null;
		}
	});

	const port = portStr && portStr.trim() ? Number(portStr) : 80;

	// Save configuration
	try {
		await config.update('host', host, vscode.ConfigurationTarget.Global);
		await config.update('username', username, vscode.ConfigurationTarget.Global);
		await config.update('password', password, vscode.ConfigurationTarget.Global);
		await config.update('port', port, vscode.ConfigurationTarget.Global);

		vscode.window.showInformationMessage('Fibaro HC3 configuration saved successfully!');
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function testFibaroConnection(): Promise<void> {
	// Helper function to load .env file
	const loadEnvFile = (): { HC3_URL?: string; HC3_USER?: string; HC3_PASSWORD?: string } => {
		const path = require('path');
		const os = require('os');
		const fs = require('fs');
		
		const envPath = path.join(os.homedir(), '.env');
		const envConfig: any = {};
		
		try {
			if (fs.existsSync(envPath)) {
				const envContent = fs.readFileSync(envPath, 'utf8');
				envContent.split('\n').forEach((line: string) => {
					const trimmedLine = line.trim();
					if (trimmedLine && !trimmedLine.startsWith('#')) {
						const [key, ...valueParts] = trimmedLine.split('=');
						if (key && valueParts.length > 0) {
							const value = valueParts.join('=').replace(/^["']|["']$/g, '');
							if (key === 'HC3_URL' || key === 'HC3_USER' || key === 'HC3_PASSWORD') {
								envConfig[key] = value;
							}
						}
					}
				});
			}
		} catch (error) {
			console.warn('Failed to read .env file:', error);
		}
		
		return envConfig;
	};

	const config = vscode.workspace.getConfiguration('hc3McpServer');
	
	// Try VS Code settings first
	let host = config.get<string>('host');
	let username = config.get<string>('username');
	let password = config.get<string>('password');
	const port = config.get<number>('port', 80);

	// If VS Code settings are incomplete, try environment variables
	if (!host || !username || !password) {
		const envConfig = loadEnvFile();
		
		if (!host && envConfig.HC3_URL) {
			try {
				const url = new URL(envConfig.HC3_URL.startsWith('http') ? envConfig.HC3_URL : `http://${envConfig.HC3_URL}`);
				host = url.hostname;
			} catch {
				host = envConfig.HC3_URL;
			}
		}
		
		if (!username && envConfig.HC3_USER) {
			username = envConfig.HC3_USER;
		}
		
		if (!password && envConfig.HC3_PASSWORD) {
			password = envConfig.HC3_PASSWORD;
		}
	}

	if (!host || !username || !password) {
		vscode.window.showWarningMessage('Please configure Fibaro HC3 settings first using "Configure Fibaro HC3 Connection" command or create a ~/.env file with HC3_URL, HC3_USER, and HC3_PASSWORD.');
		return;
	}

	const url = `http://${host}:${port}/api/settings/info`;
	const auth = Buffer.from(`${username}:${password}`).toString('base64');

	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Testing Fibaro HC3 connection...',
			cancellable: false
		}, async () => {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Authorization': `Basic ${auth}`,
				},
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = await response.json() as any;
			
			// Determine config source
			const configSource = config.get<string>('host') ? 'VS Code settings' : '~/.env file';
			
			vscode.window.showInformationMessage(
				`✅ Successfully connected to Fibaro HC3!\n` +
				`Host: ${host}:${port}\n` +
				`Version: ${data.softwareVersion || 'Unknown'}\n` +
				`Serial: ${data.serialNumber || 'Unknown'}\n` +
				`Config source: ${configSource}`
			);
		});
	} catch (error) {
		vscode.window.showErrorMessage(
			`❌ Failed to connect to Fibaro HC3: ${error instanceof Error ? error.message : String(error)}\n\n` +
			`Please check your configuration and ensure your HC3 system is accessible.`
		);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('👋 Extension deactivated');
}

async function configureCopilotMcp(): Promise<void> {
	const extensionPath = vscode.extensions.getExtension('GsonSoft-development.hc3-mcp-server')?.extensionPath;
	const mcpServerPath = extensionPath ? `${extensionPath}/out/mcp/hc3-mcp-server.js` : '/path/to/your/extension/out/mcp/hc3-mcp-server.js';
	
	const config = vscode.workspace.getConfiguration('hc3McpServer');
	const host = config.get<string>('host', '192.168.1.57');
	const username = config.get<string>('username', 'admin');
	const password = config.get<string>('password', 'your_password');
	const port = config.get<number>('port', 80);

	const configTemplate = `{
  "github.copilot.chat.experimental.mcpServers": {
    "hc3-smart-home": {
      "command": "node",
      "args": ["${mcpServerPath}"],
      "env": {
        "FIBARO_HOST": "${host}",
        "FIBARO_USERNAME": "${username}",
        "FIBARO_PASSWORD": "${password}",
        "FIBARO_PORT": "${port}"
      }
    }
  }
}`;

	const choice = await vscode.window.showInformationMessage(
		'To use HC3 MCP Server with GitHub Copilot, you need to add configuration to your VS Code settings.',
		'Copy Configuration',
		'Open Settings JSON',
		'Show Instructions'
	);

	switch (choice) {
		case 'Copy Configuration':
			await vscode.env.clipboard.writeText(configTemplate);
			vscode.window.showInformationMessage('Configuration copied to clipboard! Paste it into your User Settings (JSON).');
			break;

		case 'Open Settings JSON':
			await vscode.commands.executeCommand('workbench.action.openSettingsJson');
			await vscode.env.clipboard.writeText(configTemplate);
			vscode.window.showInformationMessage('Settings opened! Configuration copied to clipboard - paste it into the JSON file.');
			break;

		case 'Show Instructions':
			const uri = vscode.Uri.file(extensionPath + '/MCP_CONFIGURATION_GUIDE.md');
			await vscode.commands.executeCommand('markdown.showPreview', uri);
			break;
	}
}
