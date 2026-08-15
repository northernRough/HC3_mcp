# Friction triage

_Generated 2026-08-15 19:59 UTC from 27 entries at `/var/lib/hc3-mcp/friction.jsonl`._


Every row below is a **candidate, not a finding**. Re-test each against a live
gateway and record a verdict:

- **confirmed** — reproduced here; safe to act on
- **refuted** — tested and did not hold. **Leave the row in.** An undocumented
  refutation gets re-adopted by whoever reads the original report next
- **untested** — plausible but unverified; must not reach a tool description or
  the server instructions

`scripts/probe.mjs` provides throwaway objects with guaranteed teardown and a
`single()` helper for one-variable tests, which is the bar a candidate has to
clear to become a finding.


## Recurring failures — 10 distinct


A tool failing the same way repeatedly is usually a missing or wrong
description rather than user error. High counts against one tool are the
cheapest wins available.


| Verdict | Count | Tool | Last | Message |
|---|---|---|---|---|
| untested | 3 | `manage_plugin_interfaces` | 0d ago | HTTP 403: Forbidden |
| untested | 2 | `get_icon` | 0d ago | get_icon: could not fetch 'User1052' (device, .svg). HC3 returns 200 with a placeholder for missing icons rath |
| untested | 2 | `create_scene` | 0d ago | HTTP 400: Bad Request - {"type":"ERROR","reason":"SceneValidationError","message":"SceneError: /opt/fibaro/lua |
| untested | 2 | `create_scene` | 2d ago | HTTP 400: Bad Request - {"type":"ERROR","reason":"SceneValidationError","message":"SceneError: /opt/fibaro/lua |
| untested | 1 | `get_device_property` | 0d ago | HTTP 404: Not Found |
| untested | 1 | `modify_device` | 0d ago | Post-write verification failed for device 4916.
Mismatched fields:
  - properties.uiView: submitted [{"compone |
| untested | 1 | `modify_device` | 2d ago | Post-write verification failed for device 4916.
Mismatched fields:
  - properties.icon: submitted {"path":"/as |
| untested | 1 | `create_quickapp_variable` | 2d ago | QuickApp variable 'dayLog' already exists on device 4933. Use set_quickapp_variable to update its value. |
| untested | 1 | `get_icon` | 3d ago | get_icon: could not fetch 'User1053' (device, .png). HC3 returns 200 with a placeholder for missing icons rath |
| untested | 1 | `modify_device` | 3d ago | modify_device requires at least one of topLevel or properties with at least one field. |


## Submitted findings — 12


### `get_icon` — 0d ago


**Verdict:** untested


**Expected:** Either get_icon fetches a user-uploaded device icon, or its negative claim is correct. The claim that no /assets path serves them appears to be false.


**Actual:** get_icon fails and reports: "user-uploaded *device* icons are not served under any known /assets path on 5.210.12 - they are addressable by numeric id via a device's deviceIcon property, but not fetchable as a file." It had tried /assets/userIcons/User1075/User1075.svg and /assets/userIcons/User1075/User10750.svg, both unrouted. But a live device on this gateway, Irrigation QA 4933, carries properties.icon = {path: "/assets/userIcons/devices/User1072/User1072.svg", source: "HC"} and renders that icon correctly in the iOS app. The tool's candidate paths omit the "devices/" segment.


**Reproduction:**

Path claim, single variable is the path: get_icon({category:"device", name:"User1075", extension:"svg", userIcon:true}) fails against /assets/userIcons/User1075/...; the same icon family on device 4933 is stored at /assets/userIcons/devices/User1072/User1072.svg. I have NOT directly fetched the devices/ path (get_icon builds its own candidates and gives no way to pass one), so the evidence is 4933's stored path plus the app rendering it, not a successful fetch. Attach claim, single variable is whether properties.icon is written: 1) create_quickapp type com.fibaro.genericDevice -> device 4953 with icon {}. 2) upload_icon device/genericDevice/svg -> User1075, id 1075. 3) modify_device({deviceId:4953, properties:{deviceIcon:1075}}) -> verified true, and properties.icon remains {}; tile renders blank. Compare device 4933, same type, which has deviceIcon 1053 AND icon.path set, and renders.


**Cost:** Two costs. First, the stated impossibility is a wrong negative of exactly the kind the finding guidance warns about, and it is baked into the tool's own error text where it will steer future sessions away from something that works. Second, and separately, upload_icon's hint says to attach an icon with modify_device({deviceId, properties:{deviceIcon: id}}). On a freshly created genericDevice QuickApp that is not sufficient: deviceIcon was set and verified on 4953, properties.icon stayed {} , and 


_Reported by Claude, Shading QA migration, attaching the Awning icon to QA 4953_


### `manage_plugin_interfaces` — 0d ago


**Verdict:** untested


**Expected:** Narrowing to a single interface, or switching action from delete to add, changes the outcome, telling us whether the refusal is per-interface or blanket.


**Actual:** All three variants return the same bare "HTTP 403: Forbidden" with no body: delete ["autoTurnOff","light"], delete ["light"] alone, and add ["energy"]. Device unchanged in every case (interfaces still ["autoTurnOff","light","quickApp"]). Identical refusal for add and delete points at the endpoint or its credentials rather than at interface-specific validation.


**Reproduction:**

Single variable varied across three calls on the same device 4952 immediately after creation, nothing else changed between them: (a) action="delete" interfaces=["autoTurnOff","light"] -> 403; (b) action="delete" interfaces=["light"] -> 403; (c) action="add" interfaces=["energy"] -> 403. Not yet isolated: whether a NON-QuickApp device also returns 403, which would separate "endpoint unavailable" from "QuickApps rejected". I have not tried that because the only candidates are live Z-Wave devices.


**Cost:** Refines the earlier finding on this tool: the refusal is not about which interface or which direction. If the endpoint is simply not permitted on this firmware or with these credentials, the tool description should say so rather than presenting add/delete as available, because the failure costs a create-and-inspect cycle to discover.


_Reported by Claude, Shading QA migration, follow-up isolation on QA 4952_


### `manage_plugin_interfaces` — 0d ago


**Verdict:** untested


**Expected:** manage_plugin_interfaces action="delete" removes the named interfaces from a QuickApp, or refuses with a reason naming which interface cannot be removed.


**Actual:** HTTP 403: Forbidden. No body detail. The device is unchanged: a follow-up get_device_info shows interfaces still ["autoTurnOff","light","quickApp"], so nothing partial was written.


**Reproduction:**

Single variable: the call itself. 1) create_quickapp name="Shading" type="com.fibaro.binarySwitch" roomId=219 with an initialView and initialProperties.quickAppVariables. Succeeds, returns deviceId 4952 with interfaces ["autoTurnOff","light","quickApp"]. 2) manage_plugin_interfaces deviceId=4952 action="delete" interfaces=["autoTurnOff","light"] on that same device, immediately after, nothing else changed. Fails with HTTP 403. I have NOT isolated whether the refusal is per-interface (autoTurnOff vs light), whether "delete" is rejected for all interfaces on all devices, or whether it is specific to QuickApp-type devices or to a device with no files pushed yet. Removing one interface at a time would isolate the first of those.


**Cost:** Cannot remove autoTurnOff from a freshly created binarySwitch QuickApp via MCP. That interface carries autoOffDefaultTime 900, so a QA using its own on/off state as an automation enable risks being turned off by the gateway 15 minutes after every enable. Workaround not yet chosen: either set params via a different path, avoid binarySwitch as the QA type, or accept the interface and never rely on the device value. Also unclear whether the 403 is HC3's or the MCP layer's, which changes the workaro


_Reported by Claude, working on the Shading QA migration (scene 247 to QA 4952)_


### `get_hc3_lua_scenes_guide` — 0d ago


**Verdict:** untested


**Expected:** Either that a scene dying on an uncaught api.* error leaves something in the log, or that the QuickApp file endpoint is stated in the guides where someone writing a gateway-side file patcher would find it. get_quickapp_file's own description gives the correct path, but a session driving REST directly from a scene does not necessarily read that tool's description first.


**Actual:** A Lua scene calling api.get("/devices/4933/files/watering") produced NO output whatsoever — not the first log line, not an error, nothing in the debug log. run_scene_sync reported success in 19ms. The scene had run and died on its first API call, before reaching any logging.

The correct endpoint is /api/quickApp/{id}/files/{name}. A bare api.get on the wrong path throws, and an uncaught throw in a scene terminates it with no trace anywhere. The failure is indistinguishable from a scene that never executed, or one whose content failed to compile.


**Reproduction:**

Single variable. Create a Lua scene whose first statement is an unwrapped api.get, then run_scene_sync and read the debug log.

  A. api.get("/devices/4933/files/watering")            — scene produces no log output at all.
  B. api.get("/quickApp/4933/files/watering")           — returns the file, scene proceeds normally.

Only the path differs. Adding a fibaro.debug before the call, and pcall around it, makes A visible as a caught error rather than silence.


**Cost:** One wasted scene run and several minutes lost to the wrong hypothesis — silence pointed at a compile failure or a scene-execution problem rather than at a bad path. The fix is a pattern worth stating in the guide: in a probe scene, log BEFORE the first API call and wrap every api.* in pcall, otherwise a bad path is invisible.


_Reported by Claude, working with Nick C. on QA 4933 (Irrigation), 15 Aug 2026_


### `patch_quickapp_file` — 0d ago


**Verdict:** untested


**Expected:** Either that a tool used earlier in a session stays reachable, or that tool_search can reliably load it back when queried with its own description text. A tool that works and then cannot be found again by any phrasing is indistinguishable from the tool having been withdrawn.


**Actual:** patch_quickapp_file was present and callable at the start of this session — I used it successfully three times against QA 4933 (icons.lua and main.lua), each returning a diff and a verified write. Later in the same session it became unreachable. Calling it directly returned:

  Tool 'mallorn MCP-HC3:patch_quickapp_file' not found.

and five subsequent tool_search calls failed to load it back, including searches using phrases lifted verbatim from its own description ("patch_quickapp_file edit", "apply edits old new dryRun expectedHash quickapp", "each old must match exactly count times or nothing is written", "edit part of a file supplying only the text to replace", and a bare "patch", which returned "No matching tools found"). Other mallorn tools continued to load normally from tool_search throughout, so the server and tunnel were up.


**Reproduction:**

NOT ISOLATED — I cannot state the trigger, and the honest summary is that I do not know what changed between the working calls and the failing ones.

What I can state: patch_quickapp_file succeeded at three points early in a long session, then after an interval of other mallorn calls (get_icon, upload_icon, update_quickapp_file, get_debug_messages) it was not found, and repeated tool_search calls with its exact description text did not return it. No error, no reconnection, no server restart that I am aware of, and other tools kept loading.

Candidate variables I did not separate: elapsed session length; the number of distinct mallorn tools loaded in between; whether an intervening update_quickapp_file call displaced it; and whether the search index ranks it below other results for every phrasing I tried.

To test: call patch_quickapp_file, then load a dozen unrelated mallorn tools via tool_search, then attempt patch_quickapp_file again — varying only the count of tools loaded in between.


**Cost:** Two edits to a 55KB engine file (watering.lua) and a 20KB main.lua had to go through a hand-written gateway-side patch scene instead: create a temp Lua scene, fetch the file over the REST API, assert the anchor matches exactly once, replace, PUT, re-read and byte-compare, then delete the scene. That worked and was verified byte-identical each time, but it is three round trips and a live scene created on a production gateway to do what one tool call does. It also cost a silent failed run when the


_Reported by Claude, working with Nick C. on QA 4933 (Irrigation), 15 Aug 2026_


### `upload_icon` — 0d ago


**Verdict:** untested


**Expected:** The upload_icon hint to name the path form — that the uploaded file is addressable at /assets/userIcons/devices/User<N>/User<N>.<ext> and can be written into properties.icon — alongside the deviceIcon id form, and to say which of the two the tile actually renders from.


**Actual:** A user icon uploaded via upload_icon renders on the device tile when its PATH is written into properties.icon from inside the owning QA:

  qa:updateProperty("icon", {path = "/assets/userIcons/devices/User1054/User1054.svg", source = "HC"})

The same file cannot be fetched back over /assets — an earlier session concluded from that failure that user icons "are not served under any /assets path, so the tile can never fetch them", and abandoned custom artwork for three days on that basis. Not fetchable and not renderable turn out to be different things, and only the second matters.

The upload_icon hint says: "Attach with modify_device({deviceId, properties:{deviceIcon: 1054}}) — device icons attach by numeric id, not name." That is the mechanism that had previously produced a BLANK tile: deviceIcon was set correctly and properties.icon was {}, and HC3 renders the tile from properties.icon, not from deviceIcon. The path form is not mentioned in the hint.


**Reproduction:**

Single variable, on any QuickApp tile. Upload an SVG with upload_icon (category "device", deviceTemplate matching the QA type). Note the returned newId N. Then, varying only the attachment mechanism:

  A. modify_device({deviceId, properties:{deviceIcon: N}}) — tile blank in the app.
  B. from inside the QA, updateProperty("icon", {path="/assets/userIcons/devices/User<N>/User<N>.svg", source="HC"}) — artwork draws.

Same file, same device, same firmware (5.210.12). Note B must run inside the owning QA: an external api.put of properties.icon is accepted and silently discarded, which is a separate finding.


**Cost:** A working feature was written off as impossible and recorded as settled in a QA source comment, where it would have kept future sessions away from it. Recovering it took a one-off test that should have been unnecessary. The eventual result was ten composed icons driving eight tile states.


_Reported by Claude, working with Nick C. on QA 4933 (Irrigation), 15 Aug 2026_


### `get_hc3_quickapp_programming_guide` — 0d ago


**Verdict:** untested


**Expected:** Either that the callback name in uiCallbacks is honoured and QuickApp:seedlingZonesChanged is invoked with an event table, per the documented QuickApp UI model where each element routes to its own named callback; or that the guide states plainly that named callbacks are not honoured per-element and every element arrives at UIAction positionally.


**Actual:** HC3 dispatched the select to QuickApp:UIAction, not to the registered callback, and delivered the event POSITIONALLY rather than as an event table:

  onAction: {"args":["onToggled","selSeedZones",["4504","4508"]],
             "actionName":"UIAction","manual":true,"deviceId":4933}

properties.uiCallbacks at that moment contained {name:"selSeedZones", eventType:"onToggled", callback:"seedlingZonesChanged"}, verified by reading the property back. QuickApp:seedlingZonesChanged was never invoked. Because UIAction's first guard is `if action ~= "onReleased" then return end`, the payload was logged and then silently dropped, so the picker appeared to accept a change and revert on the next UI refresh.

Separately and NOT isolated: before a modify_device write to uiCallbacks, the element produced no onAction trace at all. After that write it began firing. But it fires as "onToggled", which was already its registered eventType, so "the extra registrations fixed it" does not explain the observa


**Reproduction:**

NOT FULLY ISOLATED, and the two halves differ in strength.

ISOLATED (single observation, nothing varied): read properties.uiCallbacks, confirm the select is registered with callback "seedlingZonesChanged", interact with the element, read the debug log. The onAction trace names actionName "UIAction". Registration and dispatch disagree with no variable changed.

NOT ISOLATED: the transition from "no event at all" to "event fires". One modify_device call changed TWO things — it added onChanged and onReleased registrations, AND it restarted the QuickApp ("Watering QA starting" appears immediately after the write). Either could be responsible, and a stale in-memory view binding cleared by the restart explains it just as well. I tested neither in isolation, so I credited neither in the code and kept all three registrations rather than reason from an unproven cause.

To settle it on a spare QA: (a) register a multi-select under onToggled only, restart the QA, see whether it fires; then (b) add the extra eventTypes without restarting. One variable per step.


**Cost:** About two weeks of a multi-select picker that rendered correctly, accepted input, and saved nothing. No log line indicated a fault: the trace showed the event arriving, and the QA's own debug line showed it being handled, one line before the guard discarded it. Diagnosis required reading the QA source against the raw onAction args. Firmware 5.210.12, QA 4933, element type "select" with selectionType "multi".


_Reported by Claude, working with Nick C. on QA 4933 (Irrigation), 15 Aug 2026_


### `get_ios_devices` — 2d ago


**Verdict:** untested


**Expected:** A per-id GET on a collection route returns that one record, or 404. Anything built on it would otherwise appear to work.


**Actual:** GET /iosDevices/937 returned 200 with the entire 15-entry collection, identical to GET /iosDevices, rather than the single record for 937 or a 404. The path segment is ignored. Related, and useful for a cleanup tool: DELETE /iosDevices/{id} returns 400 {"reason":"MISSING_PARAMETER","message":"udid: missing required parameter"}; the same with the udid in a body, or with the udid as the path segment, gives the identical 400; only DELETE /iosDevices/{id}?udid={udid} gets past validation, returning 404 for an id/udid pair that does not exist.


**Reproduction:**

Vary only the path: api.get("/iosDevices") and api.get("/iosDevices/937") from the same Lua scene run return byte-identical 200 bodies. The DELETE shapes were varied one at a time in a second run, holding the fake udid 00000000-0000-0000-0000-000000000000 constant across all four; collection count stayed at 15 throughout, so nothing was deleted and the 404 on the query-string form is the parameter being accepted rather than a side effect.


**Cost:** Two things for the server. A per-id read of an iOS registration silently returns the whole list, so any code filtering client-side will look correct and any code taking the first element will be wrong. And stale registration cleanup is scriptable after all via DELETE /iosDevices/{id}?udid={udid}, which is worth a tool, given the record carries no last-seen or token-status field to identify staleness from and push is true on all fifteen.


_Reported by Claude, working with Nick (northernRough), 5.210.12_


### `general` — 2d ago


**Verdict:** untested


**Expected:** Both push mechanisms would report a wrong id kind the same way, so a tool wrapping either could verify its own call.


**Actual:** POST /mobile/push validates and reports. Correct iOS device id 4217 with category YES_NO: 200 with {id:258, created, devices:[4217], action:{...}}. User id 2 in mobileDevices: 400 {"reason":"deviceId","message":"wrong device type for push notification"}. Nonexistent id 999999: 404. category omitted: 500. category "STANDARD": 400 {"reason":"category","message":"wrong category for push notification"}. Empty mobileDevices list: 500. fibaro.alert reports nothing. Returned nil for all four of: ("push",{2},msg) with a real user id, ("push",{4217},msg) with a device id in the user slot, ("push",{999999},msg), and ("simplePush",{2},msg). /notificationCenter stayed at 4 entries with its newest dated 1786357761, so no trace is left there. The push record POST creates cannot be read back either: GET /mobile/push, GET /mobile/push/258 and GET /mobile/pushes all return 405.


**Reproduction:**

Single variable in each pair. For /mobile/push, hold body and category constant and vary only mobileDevices between {4217} and {2}: 200 versus 400. For fibaro.alert, hold type and message constant and vary only the id list between {2} and {4217}: nil versus nil, indistinguishable. Both pairs run from one Lua scene in a single execution.


**Cost:** Corrects an assumption we had been carrying that both fail silently on the wrong id kind. Only fibaro.alert does. A tool wrapping /mobile/push can assert status 200 and that the echoed devices array matches the request; a tool wrapping fibaro.alert has no verification channel at all and should say so rather than report success. Separate caveat worth documenting: 200 from /mobile/push means accepted, not delivered. A push to registration 937, which receives nothing in practice, returned a clean 2


_Reported by Claude, working with Nick (northernRough), 5.210.12_


### `general` — 2d ago


**Verdict:** untested


**Expected:** Some REST path reaches scene variables, so the MCP could offer a get/set tool for them the way it does for globalVariables and quickAppVariables.


**Actual:** Every REST path tried returns 501 with an empty string body: GET /scenes/788/variables, GET /scenes/788/variables/probeVar, GET /scenes/788/variable/probeVar, POST /scenes/788/variables {name,value}. GET /scenes/788 returns 200 with 21 keys and none of them holds variables: categories, content, created, description, enabled, hidden, icon, iconExtension, id, isRunning, maxRunningInstances, mode, name, protectedByPin, restart, roomId, sortOrder, started, stopOnAlarm, type, updated. Inside the same scene run, fibaro.setSceneVariable("probeVar", "probe-1786648475") followed by fibaro.getSceneVariable returned "probe-1786648475" correctly.


**Reproduction:**

Single variable is the path. From a Lua scene, api.get("/scenes/788/variables") returns 501 while api.get("/scenes/788") returns 200 against the same gateway in the same run. Control established in the same run: three paths known not to exist (/scenes/788/thisPathDoesNotExist, /completeNonsenseEndpoint GET and POST) also return 501 empty, and two known-good paths (/users/2, /notificationCenter) return 200 with bodies. So 501-empty is this gateway's no-such-route response and the variable paths are genuinely absent, not misnamed.


**Cost:** Prevents a wrong assumption in tool design. Scene variables are Lua-only on this firmware, so an agent cannot read or write scene state at all. Worth documenting as unreachable, with the recommendation that scene state an agent needs to see must live in a global variable or a QuickApp variable instead.


_Reported by Claude, working with Nick (northernRough), 5.210.12_


### `create_scene` — 2d ago


**Verdict:** untested


**Expected:** create_scene documents `content` as optional ("Scene body. String or object"), so omitting it should create an empty scene ready to be populated by update_scene_content.


**Actual:** HTTP 400: {"type":"ERROR","reason":"SceneValidationError","message":"SceneError: /opt/fibaro/lua_engine/lua/engine.lua:623: attempt to concatenate a nil value (field 'conditions')\nstack traceback:\n\t/opt/fibaro/lua_engine/lua/engine.lua:623: in function 'engine.subscribe'\n\t/opt/fibaro/lua_engine/lua/engineMain.lua:27: in function 'engineSubscribe'."} Retrying with content = {"actions":"fibaro.debug(\"PROBE\",\"placeholder\")","conditions":"{ conditions = {}, operator = \"any\" }"} and nothing else changed succeeded, returning sceneId 788.


**Reproduction:**

Isolated to one variable. Call create_scene twice with identical name/roomId/type ("lua"), varying only `content`: omitted fails with the 400 above; supplying {actions, conditions} where conditions is a Lua table string succeeds. Both attempts made within the same minute against the same gateway.


**Cost:** One failed create before the shape was guessed. Low cost here, but the error surfaces from the Lua engine rather than the validation layer, so it reads like a server fault rather than a missing parameter. Suggest making content required, or defaulting conditions to a valid empty table when content is omitted.


_Reported by Claude, working with Nick (northernRough), 5.210.12_


### `general` — 4d ago


**Verdict:** untested


**Expected:** friction log survives a restart


**Actual:** verifying StateDirectory took effect


**Reproduction:**

submitted before and after adding StateDirectory=hc3-mcp; only the unit changed between the two runs


_Reported by statedir-check_


<!-- BEGIN manual ledger -->

## Claim ledger

Claims that arrived by field report rather than through telemetry. One row
each, with a verdict. **Refuted rows stay here permanently** — twice now a
claim refuted on this gateway has come back in a later report because the
refutation lived only in a changelog nobody re-read.

Verdicts are `confirmed` (reproduced here), `refuted` (tested here and did not
hold), `untested` (plausible, unverified — must not reach a tool description or
the server instructions).

### Source: irrigation/RoomManager project, 13 August 2026

A consolidated set of learnings from a project that builds scenes and
QuickApps through this server. Reviewed against what this repo has already
tested. Some items predate MCP improvements that have since landed.

#### Refuted — do not re-adopt

| Verdict | Claim | Evidence |
|---|---|---|
| **refuted** | `filter_devices` wants `parentId` as a string, not an integer | Tested on 5.210.12 against a parent with 185 children: `[1]` and `["1"]` **both** returned all 185. Recorded in CHANGELOG 4.15.0. This is the **second** arrival of this claim. |
| **refuted** | Z-Wave parameter writes are broken on all REST paths; only the web UI transmits | Two thirds correct, but false as stated. `POST /api/devices/{id}/action/setConfiguration` **does** transmit and ships as `set_device_parameter` (CHANGELOG 4.x). What *is* confirmed: `setParameter`/`reconfigure`/`pollConfigurationParameter` return `-3 not implemented`, and a `modify_device` PUT of `properties.parameters` caches without transmitting (verified against a Zooz ZEN52). A project doing this by hand in the web UI does not need to. |
| **refuted (as phrased)** | Parameter order differs by context: scenes `fibaro.setTimeout(delayMs, cb)`, QuickApps `setTimeout(cb, delayMs)` | Both signatures are real but **the axis is the function name, not the context**. `fibaro.setTimeout` is delay-first everywhere; bare `setTimeout` is callback-first. This repo's own `docs/programming-examples.ts` uses `fibaro.setTimeout(self.checkInterval, function() … end)` inside QuickApp code. Applying "in a QA, callback first" to a `fibaro.setTimeout` call writes a bug. |

#### Confirmed here already — agreed

| Verdict | Claim | Where it is recorded |
|---|---|---|
| **confirmed** | A `select` without `selectionType` blanks the entire rendered view, no error | 4.16.0, verified on 5.210.12. Now also refused by `modify_device` (4.18.0). |
| **confirmed** | `values` in a layout must be `json.array()`, not `{}` | 4.16.0, verified. Also refused by `modify_device` (4.18.0). |
| **confirmed** | `update_multiple_quickapp_files` restarts the QA once | 4.15.0 |
| **confirmed** | Create all QA variables before any `api.put` that also restarts | 4.15.0 — each external variable write restarts the QA, once per call; a write issued after another restarting call may never run. |
| **confirmed** | `get_scenes` needs a double `json.loads` | Structural: `content` is a JSON string inside a JSON record. **Fixed in 4.18.0** — `get_scene(block:"actions")` returns parsed Lua directly. |
| **confirmed** | `get_hc3_time` weekday must be read, never recomputed | `get_hc3_time` computes and returns `weekday` explicitly for this reason. |
| **confirmed** | Tool schemas cache at connect; re-search after a server upgrade | In the server instructions. |
| **confirmed** | Discovery and watchdog logic must exclude child devices | `find_devices_by_name` already filters to top-level devices. |
| **confirmed** | "The call didn't throw" is not "it worked" | Near-verbatim the first line of this server's instructions. |
| **confirmed** | Triggers are the JSON conditions declaration, not HC2 `%%` headers | Modelled that way by `create_scene` / `update_scene_content`. |

#### Untested — plausible, must be probed before use

| Verdict | Claim | Note |
|---|---|---|
| **untested** | Multi-select delivers the selection nested one level: `{values={{"id1","id2"}}}` | |
| **untested** | Manual run detection: `trigger.type == "user" and trigger.property == "execute"` | |
| **untested** | Cron needs `matchInterval`; plain `match` with a 6-element array "does not fire reliably" | A reliability claim needs repetition, not one observation. |
| **untested** | `Style.color` is ignored on 5.210.12; carry state in caption text | Already recorded as not-adopted in 4.16.0. The new report adds a firmware number but still no isolation test. |
| **untested** | FGS-2x3: params 10/15 are operating mode (0 disables); time params 12/17 at 0 mean 0.1s, not disabled | Check the device manual first — that is free. |
| **untested** | FGR223 unresponsive-but-confirmed means lost calibration after a power cut; HC3 reports stale position | |

#### Resolved

| Verdict | Claim | Resolution |
|---|---|---|
| **confirmed** | Named `uiCallbacks` dispatch as `method(self, event)` with `{eventType, elementName, values, deviceId}` | **Resolved 13 Aug 2026 — both records were true.** HC3 rewrites named callbacks *at creation only*. Writing the named array back with `modify_device` afterwards sticks, survives a later `update_multiple_quickapp_files` push (modified timestamp unchanged), and dispatches the named method. Isolated by the reporting project on scratch QA 4950. The dispatch was re-verified here read-only from the `UIEvent:` trace line that probe left behind. |
| **confirmed** | HC3 emits an undocumented trace-level `UIEvent:` line carrying the event table, immediately before dispatch | Re-verified here independently and read-only: `UICBPROBE trace UIEvent: {"values":[],"deviceId":4950,...}`. Means the UI event path can be confirmed without instrumenting the QuickApp. Now in the `call_ui_event` description. |
| **confirmed** | `call_ui_event` returns nothing — no ack, no echo, no indication a callback was bound | Confirmed in this repo's own source. Fixed in 4.19.0: the tool now reports the matched `uiCallbacks` entry and warns when there is none. |
| **confirmed** | `update_multiple_quickapp_files` returns only `{name, isMain, isOpen}`, so the push result cannot serve as verification | Confirmed in source. Fixed in 4.19.0 — both file-write tools now return `bytes` + `contentHash`, taken from the verify fetch they were already doing and discarding. |

#### Settled by the reporter's own testing, 14 Aug 2026

Three documents arrived from the same project (`hc3-scene-execution-model.md`,
`Useful_learnings.md`, `Some_useful_code_samples.md`), carrying results rather
than claims. **The reporter tested the timer model themselves and refuted their
own earlier report**, which is the single most useful thing anyone has sent this
project. `scripts/probe-scene-timer.mjs` was then run here against a second
gateway and agreed on every arm, which is why the timer finding is now stated in
the server instructions rather than only in a guide. All six throwaway objects
(three scenes, three globals) were torn down by the probe's `finally`.

| Verdict | Claim | Evidence |
|---|---|---|
| **refuted** | When a scene timer fires, HC3 restarts the scene and the callback runs in a fresh instance | **Now tested twice, on two gateways, by two people.** Field report: two scratch scenes, 5.210.12, three identical runs, a top-of-scene counter reading **1, not 2**. Re-run here 14 Aug 2026 with `scripts/probe-scene-timer.mjs` on scratch scenes 794/795: the no-timer control arm scored `tops=1`, the timer arm also scored `tops=1` with `callbacks=1`. The instance stays alive and services its own callback. |
| **refuted** | Closure captures are gone in the callback, so `if token == savedToken` fails silently | Same field runs, and re-run here on scratch scene 796: the callback saw `INSTANCE-1`, the value captured by the run that armed it — not nil, and not a later instance's value. That third outcome mattered, because it is the one that produces the reported symptom while looking like closure loss; it did not occur. The closure-free workaround is unnecessary. |
| **refuted (as stated)** | HC3 holds the timer, not the instance, so the instance may exit with a timer pending | The instance does not exit. What destroys a pending timer is anything that destroys the instance: reboot, saving or editing the scene, engine restart, or a new trigger arriving while `restart = true`. |
| **confirmed** | `quickApp` is unassigned until `onInit` returns | And worse than reported: it reports `type` `userdata` with a `tostring` of `custom [luabind::detail::null_type] object: (nil)` **while being fully usable** — `quickApp:debug` worked at 0 ms, 1 s and 5 s. So `if quickApp == nil` and any `tostring` test both lie. Now in the QuickApp guide. |
| **confirmed** | `getVariable` returns `""` rather than nil for a missing variable | And a missing variable is byte-identical to one deliberately set to `""`. The only signal is an HC3 log warning `Variable <name> not found`, which the Lua cannot see. Now in the guide and on `get_quickapp_variable`. |
| **confirmed** | Manual run detection is `type == "user"` **and** `property == "execute"` | Both halves. Previously confirmed here read-only from a production scene's conditions block; now independently stated by the reporter too. |
| **untested** | Scene variables have no REST API | Attributed to jgab (forum topic 79129), not tested here or by the reporter. Carried in the scenes guide **labelled as attributed**, because if true it decides where state belongs — and it decides whether the "no scene-variable tool" gap below is closable at all. |
| **untested** | Coroutines are not available on HC3 | Attributed to jgab's QuickApps series. Included in the QuickApp guide because the failure mode is a whole class of copied `coroutine.yield` HTTP wrappers, and the cost of heeding it wrongly is nil. Worth an isolation test. |

Consequence for the roadmap: the scene-variable tool listed as a gap below may be
**unbuildable rather than unbuilt**. Settle the REST claim before promising it.

#### The telemetry table above, read correctly — 13 Aug 2026

The generated "Recurring failures" table hard-codes the verdict `untested`, so a
row cannot be marked resolved there. These two are.

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | The `upload_icon` row is a server defect, not user error — it is 12 of 12 recorded entries | The schema's `required` was `['base64', 'mime', 'category']`, while the handler refuses `base64` for a device state set and refuses a device upload with no `deviceTemplate`. Obeying the schema therefore guaranteed the refusal, and the real requirement lived only in prose, in the second paragraph of a ~4,000 character description. **Fixed in 4.19.2**: `required` is `['mime', 'category']` with an `if`/`then`/`else` stating the dependent requirement in schema, where a client can act on it before the call. |
| **confirmed** | A friction log can contain the test suite's own output, and the table cannot tell you so | Until 4.19.2, an explicit but unwritable `MCP_FRICTION_LOG` fell through to the next candidate. `unit-friction.mjs` sets exactly that to prove telemetry never throws, so every `npm test` run appended two fixture entries to the developer's own `~/.hc3-mcp` log — **all 19 entries on that machine were fixtures**, including 5 `upload_icon` failures byte-identical in shape to real ones. The deployed unit's 12 are genuine: `scripts/pi-update.sh` runs `npm ci` and `npm run compile`, never `npm test`. Fixed by using an explicit path or disabling, by disabling telemetry across the suite, and by `npm run triage` refusing to regenerate a file that was generated from a different log. |


#### Confirmed by the read-only verification pass, 13 Aug 2026

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | Cron needs `operator = "matchInterval"` with `value = { date = {"*"x6}, interval = N }` in seconds | Read live from scene 645's `conditions` block, in production use: `interval = 60`. |
| **confirmed** | Manual run detection: `trigger.type == "user"` with `property == "execute"` | Same block: `{ isTrigger = true, property = "execute", type = "user" }`. |
| **untested** | Plain `match` with a 6-element cron array "does not fire reliably" | Untouched by the above — confirming the `matchInterval` form works says nothing about whether `match` fails. Still a negative reliability claim needing repetition, not one observation. |


#### Client-side, confirmed 13 Aug 2026

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | A client's cached tool list survives a reconnect; only a new session refreshes it | Three reconnects across one session, plus a `/mcp reconnect` the host did not support. `get_quickapp_file` kept its 4.17.0 schema and the 4.18/4.19 tools never appeared, while the server answered with 4.19.1 response fields throughout. **New tools are the visible casualty; new parameters on existing tools pass through the stale schema and work.** |
| **confirmed** | `get_server_info` cannot tell you whether your schemas are current | It reports live server state, so it shows the new version while the client is still holding the old tool list — it looks like confirmation and is not. |

#### Agreed, no test needed — design and practice

`fibaro.alert("push", {ids}, msg)` takes **user** ids while `api.post("/mobile/push")` takes **iOS device** ids, and the wrong kind fails silently; interactive push needs `category = "YES_NO"` (`"STANDARD"` → 400, omitted → 500); never bare-`pcall` a notification call. Marked empirically verified by the reporter on 25 July, and the 400/500 specificity reads as real testing. **This server has no push-sending tool at all**, so the knowledge currently has no home here — `get_ios_devices` is the tool that would supply the device ids.

Also agreed as sound design rather than gateway facts: closure-free callbacks as the workaround; the `delayUntil` / `schedDrain` persist-intent-and-re-derive pattern (correct whether or not the restart model holds, which is the best thing you can say about a design resting on an unverified mechanism); `self.properties.*` being effectively read-only; any class method being publicly callable via `fibaro.call` and REST; `QuickAppChild` for derived metrics; scene variables over globals; boolean flags defaulting to the safe behaviour; and the eight-step pipeline with an independent step 8.

Out of scope for this repo, not wrong: RoomManager 4742 as the control point, `config.lua` as canonical id source, the first-touch rule. Those are that project's conventions, not HC3 behaviour.

### The scene timer model — settled 14 Aug 2026

**Answer: the instance survives, the top does not re-run, and closures live.**
The three timer claims were one mechanism, and the reporting project settled it
on their own gateway before this probe was ever run. Kept below because the
method is what makes the answer trustworthy, and because a future firmware may
need it re-run. `scripts/probe-scene-timer.mjs` tests it two ways:

1. **Restart counting.** Two arms of the same scene body differing only in
   whether a `setTimeout` is armed; the top-level counter is sampled once
   before the timer is due and once after, so a second execution is *tied to*
   the callback rather than merely observed at the end. The control arm must
   score exactly one execution or the run reports inconclusive.
2. **Closure survival.** A local is captured by the callback and compared
   against a freshly-read global. This measures the thing their code actually
   depends on, as a single boolean, without inferring anything about restarts.

Both matter because they distinguish *"the instance died"* from *"the instance
died and the top re-ran"* — different problems with different fixes. Note that
closure-broke/closure-free-worked is **consistent with** the restart model but
does not uniquely establish it: a sandbox that discards closures without
re-running the top produces the same symptom.

### Gaps this exposed in the server

- No push-sending tool, so the verified push routing rules have nowhere to live.
- No scene-variable tool, despite "scene variables beat globals" being sound.
  **May be unbuildable**: scene variables are reported to have no REST API at all
  (jgab, forum topic 79129), untested here. Settle that before promising the tool.
- ~~`update_quickapp_file` still echoes HC3's PUT response~~ — **closed in
  4.19.0**, which is recorded four rows up in this same file: both file-write
  tools return `bytes` + `contentHash`, taken from the verify fetch they were
  already doing. It stayed listed as an open gap until 4.19.2. A stale
  open-gap row is precisely the failure this file exists to prevent, so it is
  struck rather than deleted.

### Source: report_finding, 11–15 August 2026 — twelve findings

The first batch to arrive through the tool rather than as a document. Eleven
real (one is a `statedir-check` self-test), from two projects: the **Irrigation**
QA in Gardens, and the **Shading** migration in System Devices. They are listed
in the generated section above and, apart from the row below, **all still need
verdicts**.

Note when re-testing: two of the devices the findings name no longer exist. The
Shading QA they were filed against was a `binarySwitch` that has since been
replaced by the `genericDevice` now called Shading, and the scratch QA behind
the "Resolved 13 Aug" uiCallbacks row below has been deleted. Neither can be
re-inspected, only reproduced.

#### Settled

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | `get_icon` cannot fetch user-uploaded device icons, and its error text asserts they are not served under any `/assets` path — a wrong negative | Reproduced and fixed in 4.21.2. The candidate paths omitted one segment: user device icons live at `/assets/userIcons/devices/User<N>/User<N>[state].<ext>`. Probed unauthenticated on 5.210.12 (`/assets` needs no credentials), single variable is the segment: `/assets/userIcons/devices/User1072/User1072.svg` → 200 `image/svg+xml` 2969 bytes; `/assets/userIcons/User1072/User1072.svg` → 200 `text/html` 13047, HC3's SPA index for an unrouted path, which is why the placeholder guard rejected every attempt. User-only: `/assets/icon/fibaro/devices/zraszacz/zraszacz0.png` returns the 1888-byte placeholder, so built-in device icons keep their layout. Two of the recurring `get_icon` rows above (`User1052`, `User1053`) are this defect; `User1053.png` fetches under the corrected path. |

Two things about this one are worth keeping. The false claim was **already
named in 4.21.0's own release note** ("user icons were concluded unrenderable
on 12 August, which was false") and the path was still never corrected, so
knowing a negative is wrong does not fix it. And `unit-icon-paths.mjs` asserted
the error must match `/not served under any known/` — a passing test pinning
the defect in place. The same file's `upload_icon` description had documented
the correct `devices/` layout throughout: the two halves disagreed and nothing
compared them.

#### Awaiting a verdict — the ones with the strongest reproductions

| Claim | Next test |
|---|---|
| `manage_plugin_interfaces` returns a bare `HTTP 403` for add *and* delete, single and multi, device unchanged | Reporter isolated three variants on the since-replaced Shading QA. Not isolated: whether a **non**-QuickApp device also 403s, which separates "endpoint unavailable here" from "QuickApps rejected". |
| `create_scene` documents `content` as optional; omitting it throws a Lua-engine 400 about concatenating a nil `conditions` | Well isolated. Fix is to require `content`, or default `conditions` to a valid empty table. 4 of the recurring failures above are this. |
| Scene variables have **no REST API**: `/scenes/{id}/variables` and three sibling paths all 501-empty, while `fibaro.setSceneVariable` works inside the run | Controls were run: known-bad paths also 501-empty, known-good return 200. If it holds, the scene-variable tool in "Gaps" below is **unbuildable**, and that gap should be struck rather than carried. |
| `upload_icon`'s attach hint (`modify_device({properties:{deviceIcon: id}})`) leaves a QuickApp tile **blank**; what renders is `properties.icon = {path, source="HC"}` written from inside the owning QA | A/B on Shading versus Irrigation. Corroborated independently by the `modify_device` post-write verification failure on **Outdoor Mean** in the table above, where `properties.icon` was submitted and did not read back — this server's own guard catching the silent discard. |
| `GET /iosDevices/{id}` returns the **entire** 15-entry collection, not one record | Anything taking the first element is wrong and looks right. Also reports `DELETE /iosDevices/{id}?udid={udid}` as the only shape that passes validation, which would make a cleanup tool buildable. |
| Named `uiCallbacks` dispatched to `UIAction` **positionally**, not to the registered callback, for a `select` with `selectionType "multi"` | **Conflicts with the "Resolved 13 Aug" row above**, whose scratch QA has since been deleted. Sharper than it looks: Irrigation's own source records `UIAction` receiving a single event **table** on 7 Aug and three **positional** args on 15 Aug, same device, same firmware. See the reconciling model below. Do not adopt either way yet. |

#### The uiCallbacks conflict, and a model that fits every observation

Four observations, none of which has to be wrong:

| When | Subject | Registered callback | What HC3 called, and how |
|---|---|---|---|
| 7 Aug | Irrigation, a button | `UIAction` | `UIAction`, one **table** argument (recorded in that QA's own source) |
| 13 Aug | a scratch QA, since deleted | a **name** | the **named method**, event table (the "Resolved" row above) |
| 15 Aug | Irrigation, `selSeedZones`, a multi `select` | a **name** | `UIAction`, three **positional** args |
| now | Irrigation, live `uiCallbacks` | five buttons on `UIAction`, the select on `seedlingZonesChanged` | — |

Two rules explain all of it:

1. **A name is honoured for buttons and ignored for selects.** A select falls
   back to `UIAction` whatever `uiCallbacks` says.
2. **The argument shape follows the dispatch path**: an honoured binding
   receives the event table, a fallback receives positional
   `(eventType, elementName, values)`.

`UIAction` is itself just a name under rule 1, which is why Irrigation's buttons
get the table form and its select does not. It also explains the half-isolated
part the reporter would not credit: adding `onChanged` and `onReleased` did not
fix the dead picker, the QA **restart** did, because the runtime binding table is
built at start.

**The discriminating test** is a select registered directly against `UIAction`.
Positional there means the shape belongs to the element type; a table means it
belongs to the fallback path. One scratch QA, four elements, one variable each:
button+named, button+`UIAction`, select+named, select+`UIAction`, with each
handler logging its own name, the argument count and the type of each argument.
Fire each element **both** by a real tap and by `call_ui_event`, because whether
the tool's channel dispatches identically to the app is itself unverified, and a
probe that only fires its own channel cannot tell you.

#### Recorded, no server fix

`patch_quickapp_file` becoming unreachable mid-session, and unrecoverable by
tool search, is client-side. Already covered by the "a client's cached tool
list survives a reconnect" row above.

#### The finding channel's own defect

`recordFinding` caps `impact` at 500 characters: **4 of the 11 real findings are
cut off mid-sentence**, and `impact` is where the cost and the suggested fix
live. One `actual` hit the 1000 cap too. Worth raising before the next batch
arrives, since the truncation is silent and lands hardest on the most thorough
reports.

<!-- END manual ledger -->


## Where a confirmed item goes

| Scope | Home |
|---|---|
| Applies to one tool | that tool's description |
| Cuts across tools, unguessable, and costly | server instructions — but only if verified here; the bar is higher because every session pays for it |
| A behaviour of HC3 rather than this server | the description of whichever tool a caller hits it through |
| Refuted | stays in this file, marked refuted, with the evidence |
