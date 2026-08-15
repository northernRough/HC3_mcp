// Extracted verbatim from src/mcp/hc3-mcp-server.ts so the doc tool
// response remains byte-identical. Do not reflow whitespace.

export const examples = {
      overview: 'Practical HC3 examples. The "patterns" category holds self-contained, gateway-tested building blocks for scenes and QuickApps; the rest are scenario snippets by domain.',

      patterns: {
        title: 'Reusable components for scenes and QuickApps',
        content: `
## Scene: trigger parsing and manual-run guard

\`\`\`lua
local function getSourceTrigger()
  local t = sourceTrigger          -- provided as a global, no declaration needed
  if type(t) ~= "table" then return { type = "unknown" } end
  return t
end

local function isManualRun(trigger)
  -- Both halves matter: type=="user" alone catches other user-originated triggers.
  return trigger.type == "user" and trigger.property == "execute"
end

local trigger = getSourceTrigger()
if isManualRun(trigger) then
  fibaro.debug("SCENE", "Manual run: inspect only, no actions.")
  return
end
\`\`\`

A manual run must not wipe state that live control depends on. If the state table
records what the automation last commanded, clearing it strands devices where they
are, because the code that would move them back is guarded by that record.

## Scene: scene-variable state store with safe init

\`\`\`lua
local function svGet(name, default)
  local v = fibaro.getSceneVariable(name)
  if v == nil or v == "" then return default end
  return v
end

local function svSet(name, value)
  fibaro.setSceneVariable(name, tostring(value))   -- values are strings
end

local function svGetNumber(name, default)
  local v = svGet(name, nil)
  return v and (tonumber(v) or default) or default
end

local function svGetBool(name, default)
  local v = svGet(name, nil)
  if v == nil then return default end
  if v == true  or v == "true"  or v == "1" then return true end
  if v == false or v == "false" or v == "0" then return false end
  return default
end

local function svInitIfMissing(name, default)
  local v = fibaro.getSceneVariable(name)
  if v == nil or v == "" then svSet(name, default); return default end
  return v
end

local function checkSceneVariables()
  svInitIfMissing("cursor", "0")
  svInitIfMissing("lastRunEpoch", "0")
  svInitIfMissing("scheduledJson", "[]")
end
\`\`\`

Scene variables are reported to have no REST API, so nothing outside the scene can
read or repair them. State you will one day need to inspect belongs in a QuickApp
using \`quickAppVariables\`.

## Scene: structured logging with room names

\`\`\`lua
local LOG_TAG = "AWNING"

local function getRoomNameByDeviceID(deviceID)
  local ok, dev = pcall(api.get, "/devices/" .. tostring(deviceID))
  if not ok or type(dev) ~= "table" then return "Unknown room" end
  if dev.roomID then
    local ok2, room = pcall(api.get, "/rooms/" .. tostring(dev.roomID))
    if ok2 and type(room) == "table" and room.name then return room.name end
  end
  return "No room"
end

local function log(level, msg)
  local fn = fibaro.debug
  if level == "WARN"  then fn = fibaro.warning end
  if level == "ERROR" then fn = fibaro.error end
  fn(LOG_TAG, msg)
end

local function logDevice(level, deviceID, msg)
  log(level, string.format("[d:%s | %s] %s", tostring(deviceID),
      getRoomNameByDeviceID(deviceID), msg))
end
\`\`\`

Room names in log lines are not cosmetic: they change behaviour, because you
troubleshoot faster and stop making wrong assumptions. The lookup costs two API
calls, so cache it in a local table inside a device loop.

## Scene: restart-safe scheduler

Use this for DURABILITY, not because of the timer model. A plain
\`fibaro.setTimeout\` survives its own callback with its closure intact (see
get_hc3_lua_scenes_guide, execution_model). This pattern earns its place when the
delay is long enough that a reboot, an engine restart, a scene edit or a
\`restart = true\` trigger could land inside it.

\`\`\`lua
local SCHED_VAR = "scheduledJson"

local function schedLoad()
  local ok, t = pcall(json.decode, svGet(SCHED_VAR, "[]"))
  return (ok and type(t) == "table") and t or {}
end

local function schedSave(jobs)
  local ok, s = pcall(json.encode, jobs)
  svSet(SCHED_VAR, (ok and s) or "[]")
end

local function schedAdd(jobType, runAtEpoch, payload)
  local jobs = schedLoad()
  jobs[#jobs + 1] = {
    type = jobType, runAt = tonumber(runAtEpoch), payload = payload or {},
    id = tostring(os.time()) .. "-" .. tostring(math.random(1000, 9999))
  }
  schedSave(jobs)
end

local function schedCancelByType(jobType)
  local kept = {}
  for _, j in ipairs(schedLoad()) do
    if j.type ~= jobType then kept[#kept + 1] = j end
  end
  schedSave(kept)
end

-- handlerFn(job) returns true when the job is consumed
local function schedDrain(handlerFn)
  local now, due, kept = os.time(), {}, {}
  for _, j in ipairs(schedLoad()) do
    if tonumber(j.runAt) and tonumber(j.runAt) <= now then due[#due + 1] = j
    else kept[#kept + 1] = j end
  end
  for _, j in ipairs(due) do
    local ok, consumed = pcall(handlerFn, j)
    if not ok or consumed ~= true then kept[#kept + 1] = j end  -- retry next run
  end
  schedSave(kept)
end
\`\`\`

Jobs drain on any scene run. To drain when nothing else triggers the scene, add a
periodic condition using \`matchInterval\` (see the scenes guide).

## Scene: window gating with a force override

\`\`\`lua
local function minutesSinceMidnight()
  local t = os.date("*t")
  return (t.hour * 60) + t.min
end

local function isWithinWindow(now, startM, endM)
  if startM <= endM then return now >= startM and now < endM end
  return now >= startM or now < endM              -- wraps midnight
end

local function shouldResetOutsideWindow(forceResetOutsideWindow, withinWindow)
  if withinWindow then return true end
  return forceResetOutsideWindow == true          -- default: do NOT reset outside
end
\`\`\`

Name boolean flags so the default is the safe behaviour and \`true\` reads as an
intentional override.

## Scene: cache an expensive daily computation

\`\`\`lua
local function cachedDaily(varName, computeFn)
  local raw = svGet(varName, nil)
  if raw then
    local ok, t = pcall(json.decode, raw)
    if ok and type(t) == "table" and t.date == os.date("%Y-%m-%d") then
      return t.value
    end
  end
  local value = computeFn()
  svSet(varName, json.encode({ date = os.date("%Y-%m-%d"), value = value }))
  return value
end
\`\`\`

A per-minute walk of the day to find sun-angle windows is thousands of
trigonometric iterations for an answer that moves about a minute per day.

## QuickApp: polling loop with backoff and jitter

\`\`\`lua
function QuickApp:initPoller()
  self._poll = { baseIntervalMs = 10000, maxIntervalMs = 300000,
                 currentMs = 10000, failures = 0, timer = nil }
end

function QuickApp:scheduleNextPoll()
  if not self._poll then self:initPoller() end
  if self._poll.timer then clearTimeout(self._poll.timer) end
  self._poll.timer = setTimeout(function() self:pollOnce() end,
                                self._poll.currentMs + math.random(0, 500))
end

function QuickApp:pollOk()
  self._poll.failures, self._poll.currentMs = 0, self._poll.baseIntervalMs
end

function QuickApp:pollFail()
  self._poll.failures = self._poll.failures + 1
  self._poll.currentMs = math.min(
    self._poll.baseIntervalMs * (2 ^ math.min(self._poll.failures, 6)),
    self._poll.maxIntervalMs)
end

function QuickApp:pollOnce()
  -- The HTTP call is async, so ok/fail arrive from the callback, not a pcall.
  self:fetchAndUpdate(function(ok, err)
    if ok then self:pollOk() else self:error("Poll error: " .. tostring(err)); self:pollFail() end
    self:scheduleNextPoll()
  end)
end
\`\`\`

Note the bare \`setTimeout\` is callback-first while \`fibaro.setTimeout\` is
delay-first, in QuickApps as well as scenes.

## QuickApp: HTTP wrapper, callback based

Coroutines are not available on HC3, so any wrapper that suspends on
\`coroutine.yield\` to fake a synchronous call does not work here. Reuse one client
rather than constructing one per request.

\`\`\`lua
function QuickApp:initHttp(timeoutMs)
  self._http = net.HTTPClient({ timeout = timeoutMs or 10000 })
end

-- cb(ok, resultOrError, status)
function QuickApp:httpJson(method, url, headers, body, cb)
  if not self._http then self:initHttp() end
  self._http:request(url, {
    options = { method = method, headers = headers or {}, data = body },
    success = function(resp)
      if resp.status < 200 or resp.status >= 300 then
        cb(false, "HTTP " .. tostring(resp.status) .. ": " .. tostring(resp.data), resp.status)
        return
      end
      local ok, obj = pcall(json.decode, resp.data)
      if not ok then cb(false, "JSON decode failed: " .. tostring(resp.data), resp.status); return end
      cb(true, obj, resp.status)
    end,
    error = function(message) cb(false, tostring(message), nil) end
  })
end
\`\`\`

## QuickApp: child device factory

\`initChildDevices\` first, or every restart creates duplicates. The class is the
SECOND argument to \`createChildDevice\`, and HC3 assigns the id, so the map from
your logical name to that id has to be persisted.

\`\`\`lua
local CHILD_MAP_VAR = "childMap"

function QuickApp:loadChildMap()
  local raw = self:getVariable(CHILD_MAP_VAR)
  if raw == "" then return {} end
  if type(raw) == "table" then return raw end
  local ok, t = pcall(json.decode, raw)
  return (ok and type(t) == "table") and t or {}
end

function QuickApp:saveChildMap(map) self:setVariable(CHILD_MAP_VAR, json.encode(map)) end

function QuickApp:ensureChild(idSuffix, name, typeName, unit)
  local map = self:loadChildMap()
  local existing = map[idSuffix]
  if existing and self.childDevices[existing] then return self.childDevices[existing] end

  local child = self:createChildDevice({
    name = name,
    type = typeName,                         -- e.g. "com.fibaro.powerMeter"
    initialProperties = {
      quickAppVariables = { { name = "metricKey", value = idSuffix } },
      unit = unit
    },
    initialInterfaces = {}
  }, BaseMeterChild)                         -- the class, as the second argument

  map[idSuffix] = child.id
  self:saveChildMap(map)
  return child
end

function QuickApp:onInit()
  self:initChildDevices({ ["com.fibaro.powerMeter"] = BaseMeterChild })
  self:initPoller(); self:initHttp(); self:initAverages()
  self.live = self:ensureChild("solar_live", "Solar Live (W)", "com.fibaro.powerMeter", "W")
  self:startPolling()
end
\`\`\`

## QuickApp: rolling average

\`\`\`lua
local function makeEma(alpha)
  alpha = math.max(0, math.min(alpha or 0.2, 1))    -- higher reacts faster
  return {
    alpha = alpha, value = nil,
    update = function(self, x)
      if x == nil then return self.value end
      self.value = (self.value == nil) and x
                   or (self.alpha * x) + ((1 - self.alpha) * self.value)
      return self.value
    end
  }
end

function QuickApp:initAverages()
  self.avg = { fast = makeEma(0.35), slow = makeEma(0.08) }
end
\`\`\`

An EMA held in a table field is lost on restart, and an external variable write
causes a restart. Persist the values to \`quickAppVariables\` and seed them back in
\`initAverages\` if the smoothing matters across restarts.

Promoting derived metrics (fast and slow averages) to child devices rather than
numbers inside one QuickApp makes history graphs usable and lets other scenes
consume them as if they were sensors.

## Position equality is not an override test

\`\`\`lua
local function movedByHand(commanded, reported, tolerance)
  return math.abs((reported or 0) - (commanded or 0)) > (tolerance or 3)
end
\`\`\`

Comparing a commanded position against a reported one with \`==\` latches a false
manual-override the first time a roller shutter reports 82 where you commanded 83.
Z-Wave position reporting drifts, particularly after a power cut has cost a shutter
its calibration.

## A default scene skeleton

\`\`\`lua
checkSceneVariables()

local trigger = getSourceTrigger()
if isManualRun(trigger) then
  log("INFO", "Manual run: draining scheduler only, no control actions")
  schedDrain(handleScheduledJob)
  return
end

schedDrain(handleScheduledJob)                      -- due jobs first

if trigger.type == "device" and trigger.property == "value" then
  local deviceID = tonumber(trigger.id)
  local v = trigger.value
  if deviceID and (v == true or v == "true" or v == 1 or v == "1") then
    schedAdd("AUTO_OFF", os.time() + 120, { deviceID = deviceID })
  end
end
\`\`\`

Persist state as soon as an action has been taken, not at the end of the body.
With \`restart = true\` a new trigger kills the instance mid-run, and anything held
in memory but not yet written is lost while the physical action has already
happened.

## QuickApp: a UI handler that survives both dispatch paths

HC3 delivers a UI event in two different shapes depending on who fired it, so a
handler written against either one alone is half-dead. Measured on 5.210.12: a
real tap always calls \`UIAction\` **positionally**, while \`call_ui_event\` calls
the callback registered in \`uiCallbacks\` with a **single event table**. A tile
verified only through the MCP can therefore be completely dead under a finger.

\`\`\`lua
-- Normalise both shapes, then dispatch on the ELEMENT, never on the eventType.
local function uiEvent(a1, a2, a3)
  if type(a1) == "table" then                 -- call_ui_event / event-table form
    return a1.eventType, a1.elementName, a1.values
  end
  return a1, a2, a3                            -- a real tap: positional
end

-- A multi-select delivers its FULL current selection, nested one level:
--   table form     {values = {{"4503","4504"}}}
--   positional arg {"4503","4504"}
-- An empty selection is MEANINGFUL — the user cleared it — so never treat it
-- as "no event".
local function selection(values)
  if type(values) ~= "table" then return nil end
  if type(values[1]) == "table" then return values[1] end
  return values
end

function QuickApp:UIAction(a1, a2, a3)
  local eventType, element, values = uiEvent(a1, a2, a3)
  self:debug(("UI %s on %s"):format(tostring(eventType), tostring(element)))

  if element == "btnRun" then
    self:runNow()
  elseif element == "selZones" then
    local picked = selection(values)
    if picked then self:applyZones(picked) end
  end
end
\`\`\`

Two things that look like defensive noise and are not. Dispatching on the
element rather than the eventType matters because a guard such as
\`if eventType ~= "onReleased" then return end\` silently eats every select event
— a select fires \`onToggled\` — and that single line killed a production picker
for two weeks while the logs showed the event arriving. And registering an
element under \`onToggled\`, \`onChanged\` AND \`onReleased\` is cheap insurance,
because which one HC3 emits for a given element is not contractual.

Register the callbacks with \`modify_device\` after creation: \`create_quickapp\`
discards supplied \`uiCallbacks\` and rewrites both the callback name and the
eventType. See get_hc3_quickapp_programming_guide({topic:"ui"}).
`
      },

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
