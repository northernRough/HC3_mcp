// Extracted verbatim from src/mcp/hc3-mcp-server.ts so the doc tool
// response remains byte-identical. Do not reflow whitespace.

export const programmingGuide = {
      overview: 'Comprehensive HC3 Quick Apps programming documentation covering Lua development, networking, and device integration.',
      
      basic: {
        title: 'Quick Apps Basics',
        content: `
## Quick Apps Fundamentals

### QuickApp Class
- Object-oriented programming in Lua
- Extend QuickApp class with custom methods
- Use 'self' to reference current instance
- Built-in methods for device integration

### onInit Method
- Called when system starts Quick App
- Initialize variables and connections
- Set up HTTP clients, TCP sockets, etc.
- Not required but recommended

### Device Integration
- Quick Apps create virtual devices
- Choose appropriate device type for best integration
- Works with scenes, panels, voice assistants
- Actions mapped to methods automatically

### Example Structure:
\`\`\`lua
function QuickApp:onInit()
    self:debug("QuickApp initialized")
    self.httpClient = net.HTTPClient()
    self.myVariable = "Hello World"
end

function QuickApp:turnOn()
    self:debug("Device turned on")
    self:updateProperty("value", true)
end
\`\`\`
        `
      },

      methods: {
        title: 'QuickApp Methods',
        content: `
## Built-in QuickApp Methods

### Logging Methods
- self:debug(message, ...) - Debug level logging
- self:trace(message, ...) - Trace level logging  
- self:warning(message, ...) - Warning level logging
- self:error(message, ...) - Error level logging

### Variable Management
- self:getVariable(name) - Get Quick App variable
- self:setVariable(name, value) - Set Quick App variable

### Device Properties
- self:updateProperty(property, value) - Update device property
- self:updateView(component, attribute, value) - Update UI component

### Action Mapping
- Method names automatically map to device actions
- fibaro.call(deviceId, "methodName", args) calls method
- Arguments passed directly to method

### Example Usage:
\`\`\`lua
function QuickApp:setValue(value)
    self:updateProperty("value", value)
    self:updateView("slider1", "value", value)
    self:debug("Value set to:", value)
end
\`\`\`
        `
      },

      http: {
        title: 'HTTP Client',
        content: `
## net.HTTPClient

### Constructor
\`\`\`lua
self.http = net.HTTPClient({timeout=3000})
\`\`\`

### Request Method
\`\`\`lua
self.http:request(address, {
    options = {
        method = 'GET',
        headers = {
            Accept = "application/json"
        },
        checkCertificate = true,
        data = "request body"
    },
    success = function(response)
        self:debug("Status:", response.status)
        self:debug("Data:", response.data)
        self:debug("Headers:", response.headers)
    end,
    error = function(message)
        self:error("HTTP Error:", message)
    end
})
\`\`\`

### Features
- HTTPS support with certificate validation
- Custom headers and request methods
- JSON data handling with json.encode/decode
- Automatic timeout handling
- Response status and header access
        `
      },

      tcp: {
        title: 'TCP Socket Client',
        content: `
## net.TCPSocket

### Constructor and Connection
\`\`\`lua
self.sock = net.TCPSocket({timeout = 10000})

self.sock:connect(ip, port, {
    success = function()
        self:debug("Connected")
    end,
    error = function(message)
        self:debug("Connection error:", message)
    end
})
\`\`\`

### Sending Data
\`\`\`lua
self.sock:send(data, {
    success = function()
        self:debug("Data sent")
    end,
    error = function(message)
        self:debug("Send error:", message)
    end
})
\`\`\`

### Reading Data
\`\`\`lua
-- Read available data
self.sock:read({
    success = function(data)
        self:debug("Received:", data)
    end,
    error = function(message)
        self:debug("Read error:", message)
    end
})

-- Read until delimiter
self.sock:readUntil("\\n", {
    success = function(data)
        self:debug("Line:", data)
    end
})
\`\`\`
        `
      },

      udp: {
        title: 'UDP Socket Client',
        content: `
## net.UDPSocket

### Constructor
\`\`\`lua
self.udp = net.UDPSocket({
    broadcast = true,
    timeout = 5000
})
\`\`\`

### Sending Datagrams
\`\`\`lua
self.udp:sendTo(data, ip, port, {
    success = function()
        self:debug("Datagram sent")
    end,
    error = function(error)
        self:debug("Send error:", error)
    end
})
\`\`\`

### Receiving Datagrams
\`\`\`lua
self.udp:receive({
    success = function(data)
        self:debug("Received datagram:", data)
        self.udp:receive() -- Continue receiving
    end,
    error = function(error)
        self:debug("Receive error:", error)
    end
})
\`\`\`

### Features
- Broadcast support
- Binary data handling
- Timeout configuration
- Connectionless communication
        `
      },

      websocket: {
        title: 'WebSocket Client',
        content: `
## WebSocket Support

### Features
- WebSocket and WebSocket Secure (WSS) clients
- Real-time bidirectional communication
- Event-driven message handling
- Connection lifecycle management

### Basic Usage
- Create WebSocket connections for real-time data
- Handle connection events and messages
- Send text and binary data
- Automatic reconnection strategies

### Use Cases
- IoT device communication
- Real-time sensor data streaming
- Home automation protocol integration
- Cloud service connectivity

Note: Full WebSocket documentation available in separate HC3 manual section.
        `
      },

      mqtt: {
        title: 'MQTT Client',
        content: `
## MQTT Client Support

### Connection
\`\`\`lua
self.client = mqtt.Client.connect(brokerURI, {
    username = "user",
    password = "pass",
    clientId = "hc3_device",
    keepAlivePeriod = 60
})

self.client:addEventListener('connected', function(event)
    self:debug("MQTT Connected")
end)
\`\`\`

### Publishing
\`\`\`lua
self.client:publish("topic/name", "message", {
    qos = mqtt.QoS.AT_LEAST_ONCE,
    retain = true
})
\`\`\`

### Subscribing
\`\`\`lua
self.client:subscribe("sensors/#", {
    qos = mqtt.QoS.EXACTLY_ONCE
})

self.client:addEventListener('message', function(event)
    self:debug("Topic:", event.topic)
    self:debug("Payload:", event.payload)
end)
\`\`\`

### Features
- QoS levels support (0, 1, 2)
- TLS/SSL connections
- Last Will and Testament
- Topic filtering with wildcards
        `
      },

      child_devices: {
        title: 'Child Device Management',
        content: `
## Managing Child Devices

### Class Definition
\`\`\`lua
class 'MyBinarySwitch' (QuickAppChild)

function MyBinarySwitch:__init(device)
    QuickAppChild.__init(self, device)
    self:debug("Child device initialized")
end

function MyBinarySwitch:turnOn()
    self:debug("Child device turned on")
    self:updateProperty("value", true)
end
\`\`\`

### Creating Child Devices
\`\`\`lua
function QuickApp:createChild()
    local child = self:createChildDevice({
        name = "Child Light",
        type = "com.fibaro.binarySwitch"
    }, MyBinarySwitch)
    
    self:debug("Child created with ID:", child.id)
end
\`\`\`

### Initialization
\`\`\`lua
function QuickApp:onInit()
    self:initChildDevices({
        ["com.fibaro.binarySwitch"] = MyBinarySwitch,
        ["com.fibaro.multilevelSwitch"] = MyDimmer
    })
    
    -- Access children
    for id, device in pairs(self.childDevices) do
        self:debug("Child:", id, device.name)
    end
end
\`\`\`

### Parent Access
- Use self.parent to access parent from child
- Share resources like HTTP clients
- Centralized configuration management
        `
      }
    };
