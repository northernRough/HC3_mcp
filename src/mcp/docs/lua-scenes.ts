// Extracted verbatim from src/mcp/hc3-mcp-server.ts so the doc tool
// response remains byte-identical. Do not reflow whitespace.

export const scenesGuide = {
      overview: 'HC3 Lua Scenes: the execution model first, then conditions, triggers, actions and the scene API. Read execution_model before writing a scene — it corrects several points that Fibaro\'s documentation and the forums get wrong.',

      execution_model: {
        title: 'Scene execution model — read this before writing a scene',
        content: `
## Why this section exists

Most HC3 scene advice in circulation is HC2 advice, or is one of two specific
myths that produce working-but-needlessly-defensive code. Every claim below was
either observed on a live gateway (firmware 5.2x) or is attributed to its source
and labelled as untested here.

## A scene is one record holding two different things

- **conditions** — a Lua table the ENGINE evaluates, declaring when the body runs
- **actions** — the Lua body the engine runs when the conditions fire

The engine owns trigger evaluation. The body never subscribes to anything and
never polls for its own triggers. This is the largest departure from HC2, where
the \`%% properties\` header was a bare change notification and every bit of
filtering happened in Lua.

\`GET /api/scenes/{id}\` returns \`content\` as a JSON string holding both blocks,
so reaching the Lua costs two parses. get_scene({block:"actions"}) does it for you.

## Conditions

\`\`\`lua
{
  conditions = {
    {
      id        = 2699,
      isTrigger = true,
      operator  = "==",
      property  = "value",
      type      = "device",
      value     = false
    }
  },
  operator = "any"
}
\`\`\`

- \`isTrigger = true\` wakes the body. \`isTrigger = false\` is a gate: it must be
  satisfied, but never wakes anything on its own.
- The outer \`operator\` is \`"any"\` or \`"all"\` across the list.
- Operator and value are filtered BEFORE any Lua runs, so the body wakes only on
  the transitions you asked for.

### Periodic scenes

\`\`\`lua
{
  isTrigger = true,
  operator  = "matchInterval",
  property  = "cron",
  type      = "date",
  value     = { date = { "*", "*", "*", "*", "*", "*" }, interval = 300 }
}
\`\`\`

\`matchInterval\`, with \`interval\` in seconds, is the form confirmed working in
production. A six-element \`match\` array has been reported as firing unreliably;
that negative claim is NOT confirmed here, so treat \`matchInterval\` as the
default rather than treating \`match\` as broken.

For \`match\`-style conditions the array order is
\`{ "seconds", "minutes", "hours", "dayOfMonth", "dayOfWeek" }\`, so every minute
is \`{ "00", "*", "*", "*", "*" }\`.

## Concurrency: one instance, one switch

**A scene runs one instance at a time.** There is no parallel execution. The only
control is \`restart\`:

| \`restart\` | A trigger arrives while the body is running |
|---|---|
| \`true\` | the new instance KILLS the running one |
| \`false\` | the running instance is protected, the trigger is dropped |

The web UI calls this "Allow to restart a running scene".

\`maxRunningInstances\` appears in the scene record and reads a constant 2 on every
scene checked, including scenes created years apart. It is not exposed in the UI
and is understood to be a leftover from the HC2 data model (jgab, Fibaro forum
topic 79129). Do not design around it and do not write it. If a scene genuinely
needs serialisation, guard it in Lua against a scene variable.

## Timers: the myth to unlearn

The widely repeated claim is that when \`fibaro.setTimeout\` fires, HC3 restarts
the scene from the top to run the callback, so closures are lost and callbacks
must re-read every piece of state.

**This is wrong**, and it has now been tested twice by different people on
different gateways. Field report: two scratch scenes, firmware 5.210.12, three
identical runs. Reproduced independently by this project's own probe
(\`scripts/probe-scene-timer.mjs\`), which runs a control arm with no timer as
the single-variable comparison and samples the counter before and after the
timer is due:

- \`fibaro.setTimeout(30000, fn)\` fired 30s later with its closure capture intact.
- A counter incremented at the top of the scene read 1, not 2 — exactly one
  top-of-scene execution per run, matching the no-timer control arm exactly.
- A local captured by the callback came back as the value the arming run set,
  not nil and not a later run's value.

The instance stays alive while timers are pending, the callback runs inside it,
and callbacks that capture local state are safe.

**What does destroy a pending timer**, because it destroys the instance: a
gateway reboot, saving or editing the scene, an engine restart, or a new trigger
arriving while \`restart = true\`.

So the persist-intent-and-re-derive pattern (a job list in a scene variable,
drained on each run) is still right for delayed work measured in hours, or for
anything that must survive a reboot. It is not required for a 30-second debounce.
Choose it for durability, not out of superstition about the timer model.

### Argument order depends on the FUNCTION, not the container

\`\`\`lua
fibaro.setTimeout(delayMs, callback)   -- delay first, everywhere, QuickApps included
setTimeout(callback, delayMs)          -- bare form, callback first
\`\`\`

The "scenes are delay-first, QuickApps are callback-first" rule is false and will
mis-write any \`fibaro.setTimeout\` call made from QuickApp code.

## Globals the body gets for free

- \`sourceTrigger\` — the trigger that woke this run, no declaration needed
- \`sceneId\` — this scene's id

### Manual run detection

\`\`\`lua
local function isManualRun(t)
  return type(t) == "table" and t.type == "user" and t.property == "execute"
end
\`\`\`

Both halves matter: \`type == "user"\` alone catches other user-originated triggers.
Treat a manual run as inspect-and-report. It should not perform reset actions that
disturb the house, and it must not wipe state that live control depends on —
clearing a table that records what the automation last commanded strands devices
where they are, because the code that would move them back is guarded by it.

## State, and the diagnostic trap

\`\`\`lua
fibaro.getSceneVariable(name)
fibaro.setSceneVariable(name, value)   -- value must be a string
\`\`\`

Initialise explicitly when missing rather than relying on nil behaviour.

**Scene variables are reported to have no REST API** — reachable only from the
builtin \`fibaro\` functions inside the scene itself (jgab, Fibaro forum topic
79129; not independently tested here). If that holds, scene state cannot be read
by this MCP, by another scene, or by a QuickApp; stuck state cannot be inspected
or repaired externally; and every diagnosis is limited to what the scene chose to
log. \`quickAppVariables\` are fully readable and writable over REST, so any logic
whose state you will one day need to inspect belongs in a QuickApp for that
reason alone.

## Scene control

\`\`\`lua
fibaro.scene("execute", { 247 })
fibaro.scene("kill",    { 247 })
\`\`\`

These replace HC2's \`fibaro:startScene\` / \`fibaro:killScenes\` / \`fibaro:countScenes\`.
The self-killing preamble every serious HC2 scene carried is now the \`restart\`
field and should not be written in Lua.

## HC2 habits that do not transfer

Listed so they can be recognised and rejected when they surface in old forum
posts, imported code, or model memory.

| HC2 | HC3 |
|---|---|
| \`%% properties\` / \`%% globals\` header declares triggers | structured conditions table, evaluated by the engine |
| header is a bare change notification, filter in Lua | operator and value filtered before Lua runs |
| many concurrent instances, capped by a setting | one instance, governed by \`restart\` |
| \`fibaro:killScenes(__fibaroSceneId)\` preamble | \`restart = true\` |
| \`fibaro:sleep(ms)\` blocks; linear code with sleeps is idiomatic | timers and callbacks |
| \`%% autostart\` plus \`while true do ... end\` daemons | use a QuickApp |
| globals are the only persistent store | scene variables, scoped and validated |
| scene \`arguments\`, \`properties\`, name-based categories | absent |

## What scenes are for

The prevailing position among HC3 developers, and a good default: scenes are
integration glue. They detect something and call into a QuickApp. Functionality
built for other people ships as a QuickApp, which updates properties or emits
custom events that scenes listen for.

A scene that has grown a state machine, a serialised state blob and several
hundred lines of control logic has outgrown the container: its state is
unreadable over REST, its restart semantics are hostile, and it has no UI.
Port it to a QuickApp.
`
      },

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
