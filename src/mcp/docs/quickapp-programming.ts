// Extracted verbatim from src/mcp/hc3-mcp-server.ts so the doc tool
// response remains byte-identical. Do not reflow whitespace.

export const programmingGuide = {
      overview: 'HC3 Quick Apps: Lua development, networking and device integration. Read gotchas first — it holds the platform behaviours that are not guessable from the language and that Fibaro\'s documentation either omits or gets wrong.',

      gotchas: {
        title: 'QuickApp gotchas — platform behaviour, not language behaviour',
        content: `
## Read this first

Every item here was observed on a live gateway (firmware 5.2x) or is a
correction to widely circulated advice. They are all things an experienced Lua
developer gets wrong, because they are platform behaviour rather than language
behaviour.

## The \`quickApp\` global lies about itself

It is unassigned during \`onInit\` and assigned before any timer callback runs,
including at 0 ms. That much is documented. What is not documented: probed on a
scratch QuickApp, firmware 5.210.12, the variable reports \`type\` of \`userdata\`
with a \`tostring\` of \`custom [luabind::detail::null_type] object: (nil)\` while
being **fully usable** — \`quickApp:debug\` worked at 0 ms, 1 s and 5 s.

So never test it with \`if quickApp == nil\` or via \`tostring\`: both lie. Inside
the class, use \`self\`.

## \`getVariable\` cannot tell you a variable is missing

It returns \`""\` for a variable that does not exist. It also returns \`""\` for one
deliberately set to \`""\`. The two are byte-identical and indistinguishable in
Lua. The only signal is that HC3 logs a warning \`Variable <name> not found\`,
which your code cannot see.

\`\`\`lua
local token = self:getVariable("TOKEN")
if token == "" then                 -- missing OR deliberately empty; you cannot tell
  self:error("TOKEN not set")
  return
end
\`\`\`

If the distinction matters, encode it: store a sentinel, or keep a separate
"configured" flag.

## Coroutines are not available

HC3's Lua does not give you working coroutines. Take this seriously when reading
any HTTP wrapper that suspends on \`coroutine.yield\` to make an async call look
synchronous — a very common shape in copied code. It does not work here.
\`net.HTTPClient\` is callback-based and everything around it has to be too.

## Writing a QuickApp variable from outside restarts the QuickApp

Once per call. Creating eight variables externally restarts it eight times
(verified: bounced within 4 s). Two consequences:

- Create every variable you need BEFORE any other call that also restarts, or a
  write issued after a restarting call may never run.
- Batch file changes with update_multiple_quickapp_files, which restarts once,
  rather than N single-file writes.

## Child devices: the API is not what most examples show

Children are created with \`initialProperties\` and \`initialInterfaces\`, with the
class passed as the SECOND argument. There is no caller-supplied \`id\` field and
no flat \`properties\` table. HC3 assigns the child's device id, and
\`self.childDevices\` is keyed by that assigned numeric id — so a logical name has
to be mapped to it explicitly, and that map has to be persisted.

\`initChildDevices\` restores existing children on every restart. **Call it before
creating anything**, or every start creates duplicates.

\`\`\`lua
class 'BaseMeterChild' (QuickAppChild)

function BaseMeterChild:__init(device)
  QuickAppChild.__init(self, device)   -- no code before this line
  self.metricKey = self:getVariable("metricKey")
end
\`\`\`

Keep the suffix-to-id map in a \`quickAppVariable\` so it survives restarts and can
be inspected over REST. See get_hc3_programming_examples({category:"patterns"})
for the full factory.

## Timer argument order depends on the function, not the container

\`\`\`lua
fibaro.setTimeout(delayMs, callback)   -- delay first, in QuickApps too
setTimeout(callback, delayMs)          -- bare form, callback first
\`\`\`

The "QuickApps are callback-first" rule is false as stated: it is true of the
bare form and wrong for every \`fibaro.setTimeout\` call.

## In-memory state does not survive a restart

A rolling average, a debounce counter or a cache held in \`self\` is gone whenever
the QuickApp restarts — and an external variable write restarts it. If the value
matters across restarts, persist it to \`quickAppVariables\` and seed it back in
\`onInit\`.

## Exclude children when scanning the device fleet

Any discovery, audit or dead-device watchdog logic must filter with
\`not d.parentId\`. Without it you detect things you do not manage, spam the log,
and act on the wrong objects. find_devices_by_name already filters this way.

## Notification routing takes two different kinds of id

\`\`\`lua
fibaro.alert("push", { userId }, msg)          -- USER ids
api.post("/mobile/push", {
  title = "Title", message = msg,
  mobileDevices = { mobileDeviceId },          -- iOS DEVICE ids
  category = "YES_NO"
})
\`\`\`

Passing the wrong kind fails silently. \`category = "STANDARD"\` returns HTTP 400
and omitting it returns 500. Never bare-\`pcall\` a notification call: capture the
outcome and log it, or delivery failure is invisible. get_ios_devices supplies
the device ids.
`
      },

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
