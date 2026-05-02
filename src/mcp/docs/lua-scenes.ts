// Extracted verbatim from src/mcp/hc3-mcp-server.ts so the doc tool
// response remains byte-identical. Do not reflow whitespace.

export const scenesGuide = {
      overview: 'Comprehensive HC3 Lua Scenes programming documentation covering conditions, triggers, actions, and automation logic.',
      
      conditions: {
        title: 'Scene Conditions and Triggers',
        content: `
## Conditions vs Triggers

### Trigger (isTrigger = true)
- Event that starts scene evaluation
- Must be specified for automatic scenes
- Examples: device state change, time, weather

### Condition (isTrigger = false)
- Factor that must be met for scene execution
- Checked after trigger occurs
- Examples: device states, time ranges, weather

### Logical Operators
- "all": All conditions must be met (AND)
- "any": At least one condition must be met (OR)
- Conditions can be nested for complex logic

### Example Structure:
\`\`\`json
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
        },
        {
            "type": "date",
            "property": "cron",
            "operator": "match>=",
            "value": ["0", "18", "*", "*", "*", "*"]
        }
    ]
}
\`\`\`
        `
      },

      triggers: {
        title: 'Trigger Types',
        content: `
## Device Triggers
\`\`\`json
{
    "type": "device",
    "id": 30,
    "property": "value",
    "operator": ">", 
    "value": 25,
    "duration": 20,
    "isTrigger": true
}
\`\`\`

## Time Triggers
\`\`\`json
{
    "type": "date",
    "property": "cron",
    "operator": "match",
    "value": ["30", "15", "*", "*", "*", "*"],
    "isTrigger": true
}
\`\`\`

## Sunrise/Sunset
\`\`\`json
{
    "type": "date", 
    "property": "sunset",
    "operator": "==",
    "value": -60,
    "isTrigger": true
}
\`\`\`

## Weather Triggers
\`\`\`json
{
    "type": "weather",
    "property": "Temperature", 
    "operator": "<",
    "value": 20,
    "isTrigger": true
}
\`\`\`

## Custom Events
\`\`\`json
{
    "type": "custom-event",
    "property": "event_name",
    "operator": "==", 
    "isTrigger": true
}
\`\`\`

## Location Triggers
\`\`\`json
{
    "type": "location",
    "id": 36,
    "property": 2,
    "operator": "==",
    "value": "enter",
    "isTrigger": true
}
\`\`\`
        `
      },

      actions: {
        title: 'Scene Actions',
        content: `
## Device Control
\`\`\`lua
-- Control single device
fibaro.call(30, "turnOn")
fibaro.call(31, "setValue", 90)

-- Control multiple devices  
fibaro.call({30, 32}, "turnOn")

-- Group actions with filters
fibaro.callGroupAction("turnOn", {
    args = {},
    filters = {
        {
            filter = "type",
            value = ["com.fibaro.binarySwitch"]
        }
    }
})
\`\`\`

## Device Information
\`\`\`lua
-- Get device properties
local value, modTime = fibaro.get(54, "value")
local value = fibaro.getValue(54, "value")
local type = fibaro.getType(54)
local name = fibaro.getName(54)
local roomId = fibaro.getRoomID(54)
\`\`\`

## Global Variables
\`\`\`lua
-- Get/set global variables
local value = fibaro.getGlobalVariable("testVar")
fibaro.setGlobalVariable("testVar", "newValue")

-- Scene variables (persistent between runs)
local value = fibaro.getSceneVariable("sceneVar")
fibaro.setSceneVariable("sceneVar", 123)
\`\`\`

## Notifications
\`\`\`lua
-- Send notifications
fibaro.alert("email", {2,3,4}, "Test message")
fibaro.alert("push", {2}, "Push notification")

-- Emit custom events
fibaro.emitCustomEvent("TestEvent")
\`\`\`

## System Control
\`\`\`lua
-- Scene control
fibaro.scene("execute", {1, 2, 3})
fibaro.scene("kill", {4, 5})

-- Alarm control
fibaro.alarm(1, "arm")
fibaro.alarm("disarm")

-- Profile control
fibaro.profile(1, "activateProfile")
\`\`\`

## Timing
\`\`\`lua
-- Delayed execution
fibaro.setTimeout(30000, function()
    fibaro.call(40, "turnOn")
end)

-- Pause execution
fibaro.sleep(5000)
\`\`\`
        `
      },

      examples: {
        title: 'Practical Examples',
        content: `
## Motion-Activated Lighting
\`\`\`json
// Conditions
{
    "operator": "all",
    "conditions": [
        {
            "type": "device",
            "id": 54,
            "property": "value",
            "operator": "==", 
            "value": true,
            "isTrigger": true
        },
        {
            "type": "date",
            "property": "sunset", 
            "operator": ">=",
            "value": 0
        }
    ]
}
\`\`\`

\`\`\`lua
-- Actions
fibaro.call({51, 52, 53}, "turnOn")
\`\`\`

## Temperature-Based Automation
\`\`\`lua
-- Check temperature and control heating
local temp = fibaro.getValue(25, "value")
if temp < 18 then
    fibaro.call(30, "turnOn")  -- Heater on
    fibaro.alert("push", {2}, "Heating activated - temp: " .. temp)
end
\`\`\`

## Advanced Device Control
\`\`\`lua
-- Get all devices in room and control them
local roomDevices = fibaro.getDevicesID({
    interfaces = {"turnOn", "turnOff"},
    roomID = 219
})

for _, deviceId in ipairs(roomDevices) do
    local deviceType = fibaro.getType(deviceId)
    if deviceType == "com.fibaro.binarySwitch" then
        fibaro.call(deviceId, "turnOff")
    end
end
\`\`\`

## Weather-Based Irrigation
\`\`\`lua
-- Start watering based on conditions
local wateringTime = 20 -- minutes

if sourceTrigger.type == "device" or 
   (sourceTrigger.type == "weather" and 
    fibaro.getValue(35, "value") < 20) then
    
    fibaro.call(2055, "turnOn")
    fibaro.setTimeout(wateringTime * 60 * 1000, function()
        fibaro.call(2055, "turnOff")
    end)
    
    fibaro.debug("Irrigation", "Started " .. wateringTime .. " minute cycle")
end
\`\`\`
        `
      },

      api: {
        title: 'API Functions',
        content: `
## HTTP API Access
\`\`\`lua
-- Direct API calls
local data, status = api.get('/devices')
local data, status = api.post('/globalVariables', {
    name = 'test',
    value = 'sampleValue'
})
local data, status = api.put('/globalVariables/test', {
    value = 'newValue'  
})
local data, status = api.delete('/globalVariables/test')
\`\`\`

## System Services
\`\`\`lua
-- System control
fibaro.homeCenter.systemService.reboot()
fibaro.homeCenter.systemService.suspend()

-- Notification service
fibaro.homeCenter.notificationService.publish({
    type = "GenericDeviceNotification",
    priority = "info",
    data = {
        deviceId = 54,
        title = "Device Alert",
        text = "Status update"
    }
})
\`\`\`

## Data Handling
\`\`\`lua
-- JSON processing
local jsonString = json.encode(sourceTrigger)
local dataTable = json.decode(response.data)

-- Source trigger information
if sourceTrigger.type == "device" then
    local deviceId = sourceTrigger.id
    local property = sourceTrigger.property
    local value = sourceTrigger.value
end
\`\`\`

## Error Handling
\`\`\`lua
-- Safe API calls with error handling
local success, result = pcall(function()
    return fibaro.getValue(deviceId, "value")
end)

if success then
    fibaro.debug("Value:", result)
else
    fibaro.error("Failed to get value:", result)
end
\`\`\`
        `
      }
    };
