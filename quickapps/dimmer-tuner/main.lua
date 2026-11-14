--[[
Dimmer Tuner — set a dimmer's LOW END by eye, from your phone.

  1. Stand where you can see the whole group of lights.
  2. Pick the dimmer, press Start: the light goes to its lowest slider level.
  3. Press Lower until it flickers or a lamp drops out, then Higher until
     every lamp is steady.
  4. Save (adds the safety margin) or Cancel (puts the old value back).

The low end is the dimmer's own "minimum level" parameter: what it outputs at
slider 1%. The slider is spread between that and the "maximum level", so after
saving, 1% is always the lowest clean level. The TOP end is tuned by measuring
power instead (the HC3 MCP tool calibrate_dimmer) — a person is only needed
here, because flicker and a lamp that will not strike are things you see.

THE REGISTER. A QuickApp cannot read Z-Wave parameters: inside a QuickApp
api.get answers 501 for every /zwave/ endpoint (5.220.15, 14 Nov 2026), and
the alternative, calling the local API with a password, would put an admin
password in another QuickApp. So the HC3 MCP (tool sync_dimmer_tuner) writes
the variable `dimmers`: one entry per dimmer with node, light, room, model and
the min/max read from the device. This QuickApp lists those, and on Save
records what it wrote (min, tunedAt) back into the same variable. That makes
`dimmers` the record to put values back from after a device recalibration (an
FGD212 overwrites its own min/max when it calibrates) or a replacement.

Writes go out as setConfiguration on the Z-Wave root device, the path proven
to transmit (radio frame counters, 14 Nov 2026).
--]]

local VERSION = "1.1.0"

-- Dimmer models, matched against the HC3 parameter template description.
local PROFILES = {
  { key = "qubino", match = "Mini Dimmer", label = "Qubino Mini Dimmer", min = 60, max = 61, size = 1, minLo = 0, minHi = 98 },
  { key = "fgd212", match = "FGD212",      label = "Fibaro FGD212",      min = 1,  max = 2,  size = 1, minLo = 1, minHi = 98 },
  { key = "zen54",  match = "ZEN54",       label = "Zooz ZEN54",         min = 4,  max = 5,  size = 1, minLo = 1, minHi = 45 },
}

local IDLE_CANCEL_MS = 10 * 60 * 1000   -- an abandoned session puts the old value back

local function profileByKey(key)
  for _, p in ipairs(PROFILES) do if p.key == key then return p end end
end

local function clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi end return v end

-- ---------------------------------------------------------------- UI helpers

function QuickApp:say(text)  self:updateView("statusLabel", "text", text) end
function QuickApp:info(text) self:updateView("infoLabel", "text", text) end

function QuickApp:showSelected()
  local s = self.sel
  if not s then self:info("No dimmer selected") return end
  local min = s.min ~= nil and tostring(s.min) or "?"
  local max = s.max ~= nil and tostring(s.max) or "?"
  local extra = ""
  if self.session then extra = string.format("  ·  started at %s", tostring(self.session.origMin)) end
  self:info(string.format("%s  ·  min %s  ·  max %s  ·  %s%s", s.name, min, max, s.profile.label, extra))
end

-- ---------------------------------------------------------------- discovery

function QuickApp:loadRegister()
  local ok, reg = pcall(json.decode, self:getVariable("dimmers") or "")
  if not ok or type(reg) ~= "table" then reg = {} end
  return reg
end

function QuickApp:scan()
  self.register = self:loadRegister()
  local list = {}
  for _, e in ipairs(self.register) do
    e.profile = profileByKey(e.model)
    if e.profile then list[#list + 1] = e end
  end
  table.sort(list, function(a, b)
    if a.room ~= b.room then return a.room < b.room end
    return a.name < b.name
  end)
  self.dimmers = list

  local options = {}
  for _, e in ipairs(list) do
    options[#options + 1] = { type = "option", text = e.room .. " — " .. e.name, value = tostring(e.lightId) }
  end
  if #options == 0 then options[1] = { type = "option", text = "(empty: ask Claude to run sync_dimmer_tuner)", value = "0" } end
  self:updateView("dimmerPicker", "options", options)
  self:say(#list > 0 and string.format("%d dimmers. Pick one, then Start.", #list)
    or "No dimmers registered yet. Ask Claude to run sync_dimmer_tuner.")
end

function QuickApp:saveRegister()
  local out = {}
  for _, e in ipairs(self.register or {}) do
    local c = {}
    for k, v in pairs(e) do if k ~= "profile" then c[k] = v end end
    out[#out + 1] = c
  end
  self:setVariable("dimmers", json.encode(out))
end

function QuickApp:select(lightId)
  if self.session then self:say("Save or Cancel the current dimmer first.") return end
  for _, e in ipairs(self.dimmers or {}) do
    if e.lightId == lightId then
      self.sel = e
      self:showSelected()
      self:say(e.min == nil and "Its current minimum is unknown. Ask Claude to run sync_dimmer_tuner."
        or "Press Start to put the light at its lowest level.")
      return
    end
  end
  self:say("That dimmer is not in the list. Press Reload.")
end

-- ---------------------------------------------------------------- session

function QuickApp:touch()
  if self.idleTimer then clearTimeout(self.idleTimer) end
  self.idleTimer = setTimeout(function()
    if self.session then
      self:cancel("No button pressed for 10 minutes: put the old value back.")
    end
  end, IDLE_CANCEL_MS)
end

function QuickApp:writeMin(value, thenLowest)
  local s = self.sel
  fibaro.call(s.rootId, "setConfiguration", s.profile.min, s.profile.size, value)
  s.min = value
  self:showSelected()
  if thenLowest then
    -- Re-send the lowest level so the output picks up the new minimum.
    fibaro.call(s.lightId, "setValue", 2)
    fibaro.setTimeout(1200, function() fibaro.call(s.lightId, "setValue", 1) end)
  end
end

function QuickApp:start()
  local s = self.sel
  if not s then self:say("Pick a dimmer first.") return end
  if s.min == nil then self:say("Its current minimum is unknown. Ask Claude to run sync_dimmer_tuner.") return end
  if self.session then self:say("Already tuning. Lower / Higher, then Save or Cancel.") return end
  local light = api.get("/devices/" .. s.lightId) or {}
  local lp = light.properties or {}
  self.session = { origMin = s.min, origValue = tonumber(lp.value) or 0, origOn = lp.state == true or (tonumber(lp.value) or 0) > 0 }
  fibaro.call(s.lightId, "setValue", 1)
  self:touch()
  self:showSelected()
  self:say(string.format("At the lowest level (min %d). Lower until it flickers or a lamp goes out, then Higher.", s.min))
end

function QuickApp:nudge(direction)
  local s = self.sel
  if not self.session then self:say("Press Start first.") return end
  if self.busy then return end
  local step = tonumber(self:getVariable("step")) or 2
  local hi = s.profile.minHi
  if s.max then hi = math.min(hi, s.max - 1) end
  local new = clamp(s.min + direction * step, s.profile.minLo, hi)
  if new == s.min then self:say(string.format("Already at the limit (%d).", s.min)) return end
  self.busy = true
  fibaro.setTimeout(1500, function() self.busy = false end)
  self:writeMin(new, true)
  self:touch()
  self:say(string.format("Min %d. Steady? Keep going, or Save. Flicker or a lamp out? Press Higher.", new))
end

function QuickApp:restoreLight()
  local s, sess = self.sel, self.session
  if sess.origOn then fibaro.call(s.lightId, "setValue", sess.origValue)
  else fibaro.call(s.lightId, "turnOff") end
end

function QuickApp:save()
  local s, sess = self.sel, self.session
  if not sess then self:say("Nothing to save — press Start first.") return end
  local margin = tonumber(self:getVariable("margin")) or 2
  local hi = s.profile.minHi
  if s.max then hi = math.min(hi, s.max - 1) end
  local final = clamp(s.min + margin, s.profile.minLo, hi)
  self:writeMin(final, false)

  s.tunedMin = final
  s.tunedAt = os.date("%Y-%m-%d %H:%M")
  self:saveRegister()

  self:restoreLight()
  self.session = nil
  if self.idleTimer then clearTimeout(self.idleTimer); self.idleTimer = nil end
  self:showSelected()
  self:say(string.format("Saved: min %d (lowest steady + margin %d). Light put back.", final, margin))
  self:debug(string.format("saved node %d (%s) min %d", s.node, s.name, final))
end

function QuickApp:cancel(why)
  local s, sess = self.sel, self.session
  if not sess then self:say("Nothing to cancel.") return end
  self:writeMin(sess.origMin, false)
  self:restoreLight()
  self.session = nil
  if self.idleTimer then clearTimeout(self.idleTimer); self.idleTimer = nil end
  self:showSelected()
  self:say(why or string.format("Cancelled: min back to %d, light put back.", sess.origMin))
end

-- ---------------------------------------------------------------- events

-- A real tap calls UIAction positionally; call_ui_event passes one table.
function QuickApp:UIAction(a1, a2, a3)
  local element, values
  if type(a1) == "table" then element, values = a1.elementName, a1.values
  else element, values = a2, a3 end
  -- Dispatch on the element; the eventType is not a filter.
  if element == "dimmerPicker" then
    local v = values
    while type(v) == "table" do v = v[1] end
    if v then self:select(tonumber(v)) end
  elseif element == "startButton"  then self:start()
  elseif element == "lowerButton"  then self:nudge(-1)
  elseif element == "higherButton" then self:nudge(1)
  elseif element == "saveButton"   then self:save()
  elseif element == "cancelButton" then self:cancel()
  elseif element == "rescanButton" then   -- "Reload": re-read the register
    if self.session then self:say("Save or Cancel first.") else self:scan() end
  end
end

function QuickApp:onInit()
  self:debug("Dimmer Tuner " .. VERSION)
  if (self:getVariable("step") or "") == "" then self:setVariable("step", "2") end
  if (self:getVariable("margin") or "") == "" then self:setVariable("margin", "2") end
  if (self:getVariable("dimmers") or "") == "" then self:setVariable("dimmers", "[]") end
  self:updateView("rescanButton", "text", "Reload dimmer list")
  self:info("No dimmer selected")
  self:scan()
end
