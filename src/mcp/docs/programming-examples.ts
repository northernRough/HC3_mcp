// Extracted verbatim from src/mcp/hc3-mcp-server.ts so the doc tool
// response remains byte-identical. Do not reflow whitespace.

export const examples = {
      overview: 'Practical HC3 programming examples and code snippets for common home automation scenarios.',
      
      lighting: {
        title: 'Lighting Control Examples',
        examples: [
          {
            name: 'Motion-Activated Lights',
            description: 'Turn on lights when motion detected, only during dark hours',
            quickapp_code: `
function QuickApp:onInit()
    self.motionSensorId = 25
    self.lightIds = {51, 52, 53}
end

function QuickApp:checkMotion()
    local motionValue = fibaro.getValue(self.motionSensorId, "value")
    local currentHour = tonumber(os.date("%H"))
    
    if motionValue and (currentHour < 7 or currentHour > 20) then
        for _, lightId in ipairs(self.lightIds) do
            fibaro.call(lightId, "turnOn")
        end
        
        -- Turn off after 10 minutes
        fibaro.setTimeout(600000, function()
            for _, lightId in ipairs(self.lightIds) do
                fibaro.call(lightId, "turnOff")
            end
        end)
    end
end
            `,
            scene_trigger: `
{
    "operator": "all",
    "conditions": [
        {
            "type": "device",
            "id": 25,
            "property": "value",
            "operator": "==",
            "value": true,
            "isTrigger": true
        }
    ]
}
            `,
            scene_action: `
local currentHour = tonumber(os.date("%H"))
if currentHour < 7 or currentHour > 20 then
    fibaro.call({51, 52, 53}, "turnOn")
    
    fibaro.setTimeout(600000, function()
        fibaro.call({51, 52, 53}, "turnOff") 
    end)
end
            `
          },
          {
            name: 'Dimmer Sunset Automation',
            description: 'Gradually dim lights based on sunset time',
            quickapp_code: `
function QuickApp:onInit()
    self.dimmerIds = {60, 61, 62}
    self:scheduleNextDimming()
end

function QuickApp:scheduleDimming()
    -- Get sunset time and start dimming 30 minutes before
    local sunsetTime = fibaro.getValue(1, "sunsetHour") 
    local dimStartTime = sunsetTime - 0.5 -- 30 minutes before
    
    fibaro.setTimeout(self:timeUntil(dimStartTime), function()
        self:startGradualDim()
    end)
end

function QuickApp:startGradualDim()
    local steps = 10
    local stepDelay = 300000 -- 5 minutes
    
    for step = 1, steps do
        fibaro.setTimeout(stepDelay * (step - 1), function()
            local brightness = 100 - (step * 10)
            for _, dimmerId in ipairs(self.dimmerIds) do
                fibaro.call(dimmerId, "setValue", brightness)
            end
        end)
    end
end
            `
          }
        ]
      },

      security: {
        title: 'Security and Monitoring Examples',
        examples: [
          {
            name: 'Door/Window Security Monitor',
            description: 'Monitor door and window sensors, send alerts and activate cameras',
            quickapp_code: `
function QuickApp:onInit()
    self.doorSensors = {70, 71, 72}
    self.cameras = {80, 81}
    self.users = {2, 3} -- User IDs for notifications
end

function QuickApp:checkSecurity()
    for _, sensorId in ipairs(self.doorSensors) do
        local isOpen = fibaro.getValue(sensorId, "value")
        local sensorName = fibaro.getName(sensorId)
        
        if isOpen then
            -- Send immediate alert
            fibaro.alert("push", self.users, 
                sensorName .. " opened - security alert!")
            
            -- Activate cameras
            for _, cameraId in ipairs(self.cameras) do
                fibaro.call(cameraId, "startRecording")
            end
            
            -- Log event
            self:debug("Security breach:", sensorName)
            
            -- Check if alarm is armed
            local alarmArmed = fibaro.getValue(1, "armed")
            if alarmArmed then
                fibaro.alarm("breach")
            end
        end
    end
end
            `,
            scene_action: `
-- Water leak detection and response
local waterSensors = {90, 91, 92}
local shutoffValves = {100, 101}

for _, sensorId in ipairs(waterSensors) do
    local waterDetected = fibaro.getValue(sensorId, "value")
    if waterDetected then
        -- Emergency shutoff
        for _, valveId in ipairs(shutoffValves) do
            fibaro.call(valveId, "close")
        end
        
        -- Alert all users
        fibaro.alert("email", {2,3,4}, "WATER LEAK DETECTED - Valves closed!")
        fibaro.alert("push", {2,3,4}, "Water leak emergency!")
        
        break
    end
end
            `
          }
        ]
      },

      climate: {
        title: 'Climate Control Examples', 
        examples: [
          {
            name: 'Smart Thermostat Logic',
            description: 'Intelligent heating/cooling based on occupancy and weather',
            quickapp_code: `
function QuickApp:onInit()
    self.thermostatId = 40
    self.tempSensors = {41, 42, 43}
    self.presenceSensors = {50, 51}
    self.targetTemp = 22
    self.checkInterval = 300000 -- 5 minutes
    
    self:startThermostatLoop()
end

function QuickApp:startThermostatLoop()
    fibaro.setTimeout(self.checkInterval, function()
        self:updateThermostat()
        self:startThermostatLoop()
    end)
end

function QuickApp:updateThermostat()
    local avgTemp = self:getAverageTemperature()
    local isOccupied = self:isHomeOccupied()
    local weatherTemp = fibaro.getValue(1, "TemperatureOutdoor")
    
    local targetTemp = self.targetTemp
    
    -- Adjust based on occupancy
    if not isOccupied then
        targetTemp = targetTemp - 3 -- Energy saving
    end
    
    -- Adjust based on weather
    if weatherTemp < 0 then
        targetTemp = targetTemp + 1 -- Extra warmth in cold weather
    end
    
    -- Set thermostat
    fibaro.call(self.thermostatId, "setTargetLevel", targetTemp)
    
    self:debug("Climate update:", {
        avgTemp = avgTemp,
        targetTemp = targetTemp,
        occupied = isOccupied,
        outdoorTemp = weatherTemp
    })
end

function QuickApp:getAverageTemperature()
    local total = 0
    local count = 0
    
    for _, sensorId in ipairs(self.tempSensors) do
        local temp = fibaro.getValue(sensorId, "value")
        if temp then
            total = total + temp
            count = count + 1
        end
    end
    
    return count > 0 and (total / count) or self.targetTemp
end

function QuickApp:isHomeOccupied()
    for _, sensorId in ipairs(self.presenceSensors) do
        if fibaro.getValue(sensorId, "value") then
            return true
        end
    end
    return false
end
            `
          }
        ]
      },

      scenes: {
        title: 'Scene Management Examples',
        examples: [
          {
            name: 'Scene Orchestration',
            description: 'Coordinate multiple scenes for complex automation',
            scene_action: `
-- Morning routine scene orchestration
local currentTime = os.date("*t")
local isWeekday = currentTime.wday >= 2 and currentTime.wday <= 6

if isWeekday then
    -- Gradual wake up sequence
    fibaro.scene("execute", {10}) -- Wake up lighting
    
    fibaro.setTimeout(300000, function() -- 5 minutes later
        fibaro.scene("execute", {11}) -- Morning music
    end)
    
    fibaro.setTimeout(600000, function() -- 10 minutes later  
        fibaro.scene("execute", {12}) -- Coffee maker
    end)
    
    fibaro.setTimeout(1800000, function() -- 30 minutes later
        fibaro.scene("execute", {13}) -- Departure preparation
    end)
else
    -- Weekend routine (more relaxed)
    fibaro.scene("execute", {20}) -- Gentle weekend wake up
end

-- Log routine start
fibaro.setGlobalVariable("lastMorningRoutine", os.date("%Y-%m-%d %H:%M:%S"))
            `
          }
        ]
      },

      devices: {
        title: 'Device Integration Examples',
        examples: [
          {
            name: 'Multi-Protocol Device Bridge',
            description: 'Bridge devices between different protocols using Quick Apps',
            quickapp_code: `
function QuickApp:onInit()
    -- HTTP client for REST API devices
    self.httpClient = net.HTTPClient({timeout = 5000})
    
    -- MQTT client for IoT devices  
    self.mqttClient = mqtt.Client.connect("mqtt://192.168.1.100", {
        username = "hc3",
        password = "password"
    })
    
    -- TCP client for proprietary protocols
    self.tcpClient = net.TCPSocket()
    
    self:setupEventHandlers()
    self:discoverDevices()
end

function QuickApp:setupEventHandlers()
    self.mqttClient:addEventListener('connected', function()
        self:debug("MQTT connected")
        self.mqttClient:subscribe("devices/+/state")
    end)
    
    self.mqttClient:addEventListener('message', function(event)
        self:handleMqttMessage(event.topic, event.payload)
    end)
end

function QuickApp:handleMqttMessage(topic, payload) 
    local deviceId = topic:match("devices/(%w+)/state")
    if deviceId then
        local data = json.decode(payload)
        self:updateVirtualDevice(deviceId, data)
    end
end

function QuickApp:updateVirtualDevice(deviceId, data)
    -- Map external device to HC3 virtual device
    local hc3DeviceId = self:getHC3DeviceId(deviceId)
    if hc3DeviceId then
        if data.state == "on" then
            fibaro.call(hc3DeviceId, "turnOn")
        else
            fibaro.call(hc3DeviceId, "turnOff")
        end
        
        if data.brightness then
            fibaro.call(hc3DeviceId, "setValue", data.brightness)
        end
    end
end
            `
          }
        ]
      },

      mqtt: {
        title: 'MQTT Integration Examples',
        examples: [
          {
            name: 'Home Assistant Integration',
            description: 'Bidirectional integration with Home Assistant via MQTT',
            quickapp_code: `
function QuickApp:onInit()
    self.mqttBroker = self:getVariable("mqttBroker")
    self.haPrefix = "homeassistant"
    
    self.client = mqtt.Client.connect(self.mqttBroker, {
        username = self:getVariable("mqttUser"),
        password = self:getVariable("mqttPass"),
        clientId = "fibaro_hc3"
    })
    
    self:setupMqttHandlers()
end

function QuickApp:setupMqttHandlers()
    self.client:addEventListener('connected', function()
        self:debug("Connected to Home Assistant MQTT")
        self:publishDeviceDiscovery()
        self:subscribeToCommands()
    end)
    
    self.client:addEventListener('message', function(event)
        self:handleHomeAssistantCommand(event.topic, event.payload)
    end)
end

function QuickApp:publishDeviceDiscovery()
    -- Publish HC3 devices to Home Assistant
    local devices = api.get("/devices")
    
    for _, device in ipairs(devices) do
        if device.type == "com.fibaro.binarySwitch" then
            local config = {
                name = device.name,
                state_topic = self.haPrefix .. "/switch/" .. device.id .. "/state",
                command_topic = self.haPrefix .. "/switch/" .. device.id .. "/set",
                unique_id = "fibaro_" .. device.id
            }
            
            self.client:publish(
                self.haPrefix .. "/switch/" .. device.id .. "/config",
                json.encode(config),
                {retain = true}
            )
        end
    end
end

function QuickApp:subscribeToCommands() 
    self.client:subscribe(self.haPrefix .. "/switch/+/set")
    self.client:subscribe(self.haPrefix .. "/light/+/set")
end

function QuickApp:handleHomeAssistantCommand(topic, payload)
    local deviceId = topic:match("/(%d+)/set")
    if deviceId then
        if payload == "ON" then
            fibaro.call(tonumber(deviceId), "turnOn")
        elseif payload == "OFF" then
            fibaro.call(tonumber(deviceId), "turnOff")
        end
    end
end

function QuickApp:publishDeviceState(deviceId, state)
    local topic = self.haPrefix .. "/switch/" .. deviceId .. "/state"
    self.client:publish(topic, state and "ON" or "OFF")
end
            `
          }
        ]
      },

      tcp: {
        title: 'TCP Protocol Examples',
        examples: [
          {
            name: 'Global Cache Integration',
            description: 'Control IR and relay devices via Global Cache modules',
            quickapp_code: `
function QuickApp:onInit()
    self.gcIP = self:getVariable("globalCacheIP") 
    self.gcPort = 4998
    self.socket = net.TCPSocket()
    
    self:connectToGlobalCache()
end

function QuickApp:connectToGlobalCache()
    self.socket:connect(self.gcIP, self.gcPort, {
        success = function()
            self:debug("Connected to Global Cache")
            self:sendCommand("getversion")
        end,
        error = function(message)
            self:error("Connection failed:", message)
            -- Retry in 30 seconds
            fibaro.setTimeout(30000, function()
                self:connectToGlobalCache()
            end)
        end
    })
end

function QuickApp:sendIRCommand(module, connector, code)
    -- Send IR command format: sendir,module:connector,id,frequency,repeat,offset,data
    local command = string.format("sendir,%d:%d,1,38000,1,1,%s\\r", 
        module, connector, code)
    
    self.socket:send(command, {
        success = function()
            self:debug("IR command sent")
        end,
        error = function(message)
            self:error("Send failed:", message)
        end
    })
end

function QuickApp:turnOnTV()
    -- Samsung TV power on code example
    local samsungPowerCode = "9000,4500,560,560,560,560,560,1690,560,560,560,1690,560,1690,560,1690,560,560"
    self:sendIRCommand(1, 1, samsungPowerCode)
end

function QuickApp:setRelayState(module, connector, state)
    -- Control relay: setstate,module:connector,state (0=off, 1=on)
    local command = string.format("setstate,%d:%d,%d\\r", 
        module, connector, state and 1 or 0)
    
    self.socket:send(command, {
        success = function()
            self:debug("Relay state set to", state)
        end
    })
end
            `
          }
        ]
      }
    };
