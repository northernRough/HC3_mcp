# Friction triage

_Generated 2026-11-13 19:44 UTC from 198 entries at `/var/lib/hc3-mcp/friction.jsonl` (the Pi, production)._


Every row below is a **candidate, not a finding**. Re-test each against a live
gateway and record a verdict:

- **confirmed** — reproduced here; safe to act on
- **refuted** — tested and did not hold. **Leave the row in.** An undocumented
  refutation gets re-adopted by whoever reads the original report next
- **untested** — plausible but unverified; must not reach a tool description or
  the server instructions
- **by-design** — not a defect. The tool saw a call it knew was wrong and
  refused it. Recorded because calling a working guard an untested candidate
  wastes the same pass as calling a fixed bug one

Verdicts come from `friction-verdicts.json`; a row with no entry there reads
`untested`, which is the safe default rather than a claim. **⚠ SEEN SINCE ON
x.y.z** means the failure was recorded BY a build that already contained its
claimed fix, so the verdict is wrong and the telemetry is right. That check
needs the version stamped on the entry (4.31.0 onward); for older entries a
date-only discrepancy is reported on the console instead, because a release
date cannot tell a failed fix apart from a gateway that had not been updated
yet.

`scripts/probe.mjs` provides throwaway objects with guaranteed teardown and a
`single()` helper for one-variable tests, which is the bar a candidate has to
clear to become a finding.


## Recurring failures — 59 distinct


A tool failing the same way repeatedly is usually a missing or wrong
description rather than user error. High counts against one tool are the
cheapest wins available.


| Verdict | Count | Tool | Last | Message |
|---|---|---|---|---|
| by-design | 12 | `filter_devices` | 6d ago | filter_devices requires filters array. <br>_Argument guard refusing a malformed call before it reaches HC3._ |
| by-design | 11 | `get_device_property` | 6d ago | get_device_property: no device 2370 on this HC3. Find the right id with find_devices_by_name or get_devices. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Not-found message working as intended. All 11 are device 2370, the harness fixture `deviceChild` in scripts/test/default-args.mjs, which no longer exists on this HC3: stale fixture, not a defect. Fix the fixture._ |
| by-design | 10 | `get_device_parameters` | 6d ago | get_device_parameters: no device 2370 on this HC3. Find the right id with find_devices_by_name or get_devices. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Same stale harness fixture (device 2370)._ |
| by-design | 9 | `get_device_property` | 6d ago | get_device_property requires a non-empty propertyName. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Argument guard; same harness run as the 2370 rows._ |
| confirmed, fixed 4.27.0 | 7 | `get_device_property` | 74d ago | HTTP 404: Not Found <br>_A bare 404 naming neither the device nor the property. The tool now re-reads the device on 404 and says which of the two is missing, listing the properties that exist; HC3HttpError carries the method and path. New occurrences will not match this signature._ |
| confirmed | 6 | `delete_device` | 6d ago | delete_device: post-delete verify failed — device 5061 still exists after DELETE. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Verify does ONE GET immediately after the DELETE. HC3 deletes asynchronously (child devices especially); callers confirmed 5070, 5071, 5072 gone moments later (findings 1793566471, 1794098351). A false failure invites a retry or a 'cannot delete' report. Fix: poll a few seconds before declaring failure._ |
| confirmed | 5 | `report_finding` | 6d ago | report_finding requires tool. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Nine refusals, one missing field at a time (tool, reproduction, expected, actual), so a caller can need four round trips to file one finding, the moment findings are likeliest to be dropped. Fix: name every missing field in one error._ |
| confirmed | 5 | `get_device_info` | 6d ago | HTTP 404: Not Found (GET /api/devices/3748) <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Bare 404 with none of the 'no device N on this HC3' wording the other tools gained in 4.27.0._ |
| confirmed, fixed 4.30.0 | 5 | `manage_plugin_interfaces` | 74d ago | HTTP 403: Forbidden <br>_The endpoint is refused on 5.210.12 for add and delete, single and multi, on QuickApps of two types AND on non-QuickApp device 3385 — whose interfaces and `modified` timestamp were byte-identical after both arms. Catalogued in KNOWN_DEAD_ENDPOINTS.md; the tool now carries it. Not fixed, because there is nothing here to fix: two of the seven are this project's own probe._ |
| confirmed | 3 | `get_event_history` | 0d ago | The operation was aborted due to timeout <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Probed 13 Nov: HC3 takes 19-20 s for /api/events/history regardless of window (1 day: 19.1 s, 7 days: 20.4 s, one device with objectType). The HTTP client aborts at 15 s (hc3-client.ts). Fix: longer timeout for this endpoint._ |
| confirmed | 3 | `update_multiple_quickapp_files` | 5d ago | HTTP 500: Internal Server Error (PUT /api/quickApp/5046/files) <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). HTTP 500 when any submitted file does not yet exist, and the write is PARTIAL: files that exist are written (finding 1794143327 saw the new main running). Fix: list files first, create missing ones via POST, then PUT the rest; report per file._ |
| by-design | 3 | `modify_device` | 12d ago | modify_device requires at least one of topLevel or properties with at least one field. <br>_Argument guard._ |
| confirmed, fixed 4.21.2 | 3 | `get_icon` | 90d ago | get_icon: could not fetch 'User1053' (device, .png). HC3 returns 200 with a placeholder for missing icons rath <br>_The candidate paths omitted a segment: user device icons live at /assets/userIcons/devices/User<N>/. The tool's own error text asserted they were not served under any /assets path, which was a wrong negative, and a unit test pinned that assertion in place._ |
| confirmed | 2 | `report_finding` | 6d ago | report_finding requires reproduction. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Nine refusals, one missing field at a time (tool, reproduction, expected, actual), so a caller can need four round trips to file one finding, the moment findings are likeliest to be dropped. Fix: name every missing field in one error._ |
| by-design | 2 | `patch_quickapp_file` | 6d ago | patch_quickapp_file refused edit 1 of 1: The text was not found. It must match byte for byte, including indent <br>_A stale or mis-indented `old` refused with nothing written. Working as intended, though a run of these on one file usually means the caller is holding an out-of-date copy._ |
| by-design | 2 | `update_climate_zone` | 12d ago | HTTP 400: Bad Request (PUT /api/panels/climate/14) - {"type":"ERROR","reason":"validation error","message":"mo <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). HC3's own validation (minimum gap between heating and cooling setpoints per slot), and the message names the slot. Worth stating the rule in the tool description._ |
| by-design | 2 | `create_global_variable` | 27d ago | create_global_variable requires a non-empty varName. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Argument guard._ |
| confirmed, fixed 4.27.0 | 2 | `get_device_parameters` | 74d ago | HTTP 404: Not Found <br>_Same bare 404. The opening device read is the tool's only unguarded request, so every one of these was a device that does not exist; it now says so._ |
| confirmed, fixed 4.21.2 | 2 | `get_icon` | 90d ago | get_icon: could not fetch 'User1052' (device, .svg). HC3 returns 200 with a placeholder for missing icons rath <br>_The candidate paths omitted a segment: user device icons live at /assets/userIcons/devices/User<N>/. The tool's own error text asserted they were not served under any /assets path, which was a wrong negative, and a unit test pinned that assertion in place._ |
| confirmed, fixed 4.18.0 | 2 | `create_scene` | 90d ago | HTTP 400: Bad Request - {"type":"ERROR","reason":"SceneValidationError","message":"SceneError: /opt/fibaro/lua <br>_`conditions` sent as a structure rather than a Lua source string. Refused locally now, with the Lua to send instead printed in the error._ |
| confirmed, fixed 4.29.0 | 2 | `create_scene` | 92d ago | HTTP 400: Bad Request - {"type":"ERROR","reason":"SceneValidationError","message":"SceneError: /opt/fibaro/lua <br>_`content` omitted. HC3 rejected the create from inside its Lua engine, naming engine.lua rather than the missing argument. create_scene now supplies a body that subscribes to nothing and reports contentDefaulted._ |
| by-design | 1 | `get_device_property` | 6d ago | get_device_property: device 4984 (Shading) has no property 'env'. It exposes 30: apiVersion, buildNumber, cate <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Informative not-found listing the properties that exist. But two of these asked for 'interfaces' and 'parentId', which are top-level device fields, not properties: the message should say so and point at get_device_info._ |
| confirmed | 1 | `modify_device` | 10d ago | Cannot use 'in' operator to search for 'quickAppVariables' in {"viewLayout": {"$jason": {"body": {"header": {" <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). `properties` arrived as a JSON string, and the handler crashed with a TypeError instead of refusing clearly. Fix: parse a JSON-string object or refuse with a plain message._ |
| by-design | 1 | `patch_quickapp_file` | 10d ago | patch_quickapp_file refused edit 3 of 3: Found 120, expected 1. Set count=120 to change them all, or extend 'o <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Guard: ambiguous `old`, nothing written._ |
| by-design | 1 | `patch_quickapp_file` | 11d ago | patch_quickapp_file: edits must be a non-empty array of {old, new} objects. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Argument guard._ |
| confirmed | 1 | `report_finding` | 12d ago | report_finding requires expected. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Nine refusals, one missing field at a time (tool, reproduction, expected, actual), so a caller can need four round trips to file one finding, the moment findings are likeliest to be dropped. Fix: name every missing field in one error._ |
| by-design | 1 | `update_climate_zone` | 12d ago | HTTP 400: Bad Request (PUT /api/panels/climate/16) - {"type":"ERROR","reason":"validation error","message":"mo <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). HC3's own validation (minimum gap between heating and cooling setpoints per slot), and the message names the slot. Worth stating the rule in the tool description._ |
| untested | 1 | `filter_devices` | 12d ago | HTTP 400: Bad Request (POST /api/devices/filter) - {"type":"ERROR","reason":"Invalid JSON","message":"get_valu <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). HC3 rejecting a filter with a null value. Probably the caller; the tool could refuse null filter values before sending._ |
| by-design | 1 | `control_device` | 12d ago | Device 4739 (a bedroom suite A/C) does not declare action 'UIAction'. Valid actions for this device: setAutoOff, t <br>_The pre-check working. HC3 silently accepts and drops invalid actions on QuickApps with an empty actions map, so this refusal is the only signal a caller gets._ |
| confirmed | 1 | `modify_device` | 12d ago | HTTP 404: Not Found (PUT /api/devices/4739) <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). HC3 answers 404 for an EXISTING device when it refuses a field: a `type` change (finding 1786897950) and viewLayout on a QuickAppChild, which uses uiView (1793551362). Reads as 'wrong id'. Fix: on 404, re-read the device; if it exists, say a field was refused and name the known cases._ |
| confirmed | 1 | `report_finding` | 12d ago | report_finding requires actual. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Nine refusals, one missing field at a time (tool, reproduction, expected, actual), so a caller can need four round trips to file one finding, the moment findings are likeliest to be dropped. Fix: name every missing field in one error._ |
| by-design | 1 | `delete_device` | 12d ago | delete_device refuses device 3437 (guest thermostat): not a QuickApp and not an explicitly-installed plugin (i <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Guard: not a QuickApp or explicitly installed plugin._ |
| by-design | 1 | `delete_device` | 12d ago | delete_device refuses device 3438 (m.suite thermostat): not a QuickApp and not an explicitly-installed plugin  <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Guard: not a QuickApp or explicitly installed plugin._ |
| by-design | 1 | `delete_device` | 12d ago | delete_device refuses device 3470 (b.suite thermostat): not a QuickApp and not an explicitly-installed plugin  <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Guard: not a QuickApp or explicitly installed plugin._ |
| by-design | 1 | `delete_device` | 12d ago | delete_device refuses device 3479 (principle bed thermostat): not a QuickApp and not an explicitly-installed p <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Guard: not a QuickApp or explicitly installed plugin._ |
| confirmed | 1 | `set_quickapp_variable` | 13d ago | QuickApp variable 'undefined' does not exist on device 4739. Known variables: daikinId, defaultCoolingSetpoint <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). "QuickApp variable 'undefined'": the call carried no name and nothing checked. Same missing-argument class as get_quickapp_variable's false 'exists:false' (finding 1794098612). Fix: require name._ |
| by-design | 1 | `audit_id_references` | 13d ago | Either deviceId or name must be provided. <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Argument guard._ |
| by-design | 1 | `get_device_property` | 13d ago | get_device_property: device 5045 (TEST zone thermostat (delete)) has no property 'interfaces'. It exposes 52:  <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Informative not-found listing the properties that exist. But two of these asked for 'interfaces' and 'parentId', which are top-level device fields, not properties: the message should say so and point at get_device_info._ |
| by-design | 1 | `patch_quickapp_file` | 13d ago | patch_quickapp_file refused: file 'main' on device 4742 has changed since you read it. Expected md5 7d63b18aba <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). expectedHash guard working._ |
| by-design | 1 | `get_device_property` | 17d ago | get_device_property: device 4638 (OW Current weather) has no property 'parentId'. It exposes 20: categories, d <br>_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Informative not-found listing the properties that exist. But two of these asked for 'interfaces' and 'parentId', which are top-level device fields, not properties: the message should say so and point at get_device_info._ |


## Submitted findings — 62


### `set_quickapp_variable` — 0d ago


**Verdict:** confirmed, fixed 4.34.0


_All three parts fixed in 4.34.0: set_quickapp_variables writes many with one PUT (one restart); set_quickapp_variable no longer points at modify_device, which rejects quickAppVariables by design; untyped variables are written as strings (true -> "true", 15 -> "15")._


**Expected:** A way to write several QuickApp variables with one restart, and tool descriptions that agree on how to do it. Values written as strings, matching how the QA itself stores them.


**Actual:** set_quickapp_variable's description says: to preserve a value exactly, "write it via modify_device with a full properties.quickAppVariables array". modify_device's description says quickAppVariables "is explicitly rejected by this tool - use set_quickapp_variable instead". So the documented batch path does not exist and five variables cost five restarts. Separately, for variables the QA created without a declared type (winterOutdoorC, winterMask, showDetail on 4984), the tool wrote JSON number 15 and boolean true rather than the strings "15" and "true"; its response shows current.value 15 and true with no type. Variables that had type "string" (selectedDevice, dryRun) stayed strings.


**Reproduction:**

On 4984: set_quickapp_variable winterOutdoorC 15 (untyped var, previous "12") returned current {value: 15}; set_quickapp_variable selectedDevice 4256 (type string, previous "4203") returned current {type:"string", value:"4256"}. One variable differs: whether the existing entry has a declared type. Shading's readNumberVar/readBoolVar tolerate both, so no harm here, but a QA that compares getVariable(...) == "true" would read false.


**Cost:** Five restarts instead of one during a live restore; a latent type change on untyped variables. Suggest: a set_quickapp_variables (plural) tool that reads the full array, merges, and PUTs once; default untyped variables to string; fix the contradictory sentence in set_quickapp_variable.


_Reported by Claude session 13 Nov 2026, Shading 4984 restore_


### `general` — 0d ago


**Verdict:** confirmed, fixed 4.34.0


_Snapshot now runs on the Pi (hc3-snapshot.timer) into /var/lib/hc3-mcp/snapshot, pushed to a private GitHub repo with secrets git-crypt-encrypted. 4.34.0 adds list_snapshots, get_snapshot_quickapp, diff_quickapp_vs_snapshot and restore_quickapp_from_snapshot, which read that repo server side; the 13 Nov restore becomes one diff and one restore call._


**Expected:** After a QuickApp is damaged, the MCP should be able to list snapshot history and restore one QuickApp's files (and optionally variables) from a named snapshot commit, server side, with a hash check per file.


**Actual:** No tool or resource exposes the nightly snapshot. Recovery of Shading 4984 on 13 Nov 2026 depended on the user remembering that the snapshot repo lives on the Mac (~/code/HC3/hc3-snapshot) and finding it in Finder. Restore then meant staging the files into the session and passing about 200 KB of Lua through the model in update_multiple_quickapp_files calls, one file at a time, relying on the returned contentHash to catch any transcription error. It worked (all 8 hashes matched), but every byte went through the model. Also: the repo comment says the Mac snapshot runs at 03:15; the log shows it ran at 01:24 UTC.


**Reproduction:**

Not a defect with a single variable; a missing capability. Ask the MCP for "the last snapshot of QA 4984": there is no tool to answer it. Compare: get_backups lists HC3's own backups (which stopped on 10 Oct 2026) but not the snapshot repo.


**Cost:** Cost about an hour and a large token spend, with the blinds in the wrong mode meanwhile. Suggested fixes, in order of value: (1) a snapshot_diff check after each nightly run that alerts when a QuickApp's file hashes changed with no edit session recorded; that would have flagged this at 01:24 the next night at the latest, and the copier pattern twice before. (2) list_snapshots / restore_quickapp_from_snapshot(deviceId, commit, files?, variables?) running on the host that holds the repo, verifying contentHash per file. (3) correct the 03:15 time in the repo docs.


_Reported by Claude session 13 Nov 2026, Shading 4984 restore_


### `general` — 0d ago


**Verdict:** confirmed


_Observed once, 13 Nov 2026 on 5.220.15: copier QA 4983 (enabled:false) ran onInit at boot and overwrote 4984 from 4953, files and variables; 4983 and 4953 since deleted, 4984 restored from the snapshot. Confirmed for that QA on that boot; NOT isolated whether every disabled QA runs onInit on boot. 4.34.0 puts the operational rule in the QuickApp guide (a one-off helper must delete or disarm itself) without claiming the general behaviour._


**Expected:** A QuickApp with enabled:false does not run its onInit, including when the gateway reboots. Disabling a QuickApp is a safe way to park it.


**Actual:** A disabled QuickApp appears to have run its onInit on gateway boot and done real damage.

QA 4983 "Shading tile probe (spent)" is a one-shot copier written in August 2026: its onInit reads every QuickApp variable and every file from QA 4953 (old Shading, disabled) and writes them into QA 4984 (live Shading), variables first via one PUT of quickAppVariables, then each file, main last. It was disabled and hidden in August once its job was done, and filter_devices on 13 Nov 2026 still reports it enabled:false, visible:false.

The HC3 rebooted itself at 03:46:08 on 13 Nov 2026 (firmware 5.220.15; not a power cut, Tesla read on_grid at 03:47:08; not a firmware change; no backup restore). At 03:47:11 QA 4984 started with old code. Afterwards 4984's files are byte-identical to 4953's:

  config  4953 c5b8b77a18b4d78a16b24fc6dc4a11c2  4984 c5b8b77a18b4d78a16b24fc6dc4a11c2  (22533 bytes, 370 lines both)
  engine  4953 6fc837417966fe3e30f98349e218e7cb  4984 6fc837417966fe3e30f98349e218e7cb  (30772 bytes, 756 lines both)
  main    4953 4dbba57c1b1a9dc9d512c386a6337339  4984 4dbba57c1b1a9dc9d512c386a6337339  (9041 bytes, 238 lines both)

and 4984's dryRun variable is back to "true", the value 4953 was left with at cutover. Before the reboot 4984 held substantially newer code (winter glare rule, mask toggle, etc.) that does not exist in 4953. Nothing else on the gateway copies 4953 into 4984.

Other QuickApps edited on 8 Nov were NOT affected: 4916 main still hashes 0cbbe77e14c7cf342f2cbd5fb79e688f and 4933 eventlog still hashes 4b3b563df5c76ae37f334112f2363b08, both exactly as last written. So this was targeted at 4984, consistent with the copier and not with a gateway-wide store rollback.


**Reproduction:**

NOT ISOLATED. The evidence is circumstantial but strong: byte-identical hashes on three files plus a reverted variable, and only one piece of code on the gateway that performs that exact copy.

What is not established: that 4983 was disabled at the moment it ran. It reads enabled:false now, but I have not seen its state at 03:46. It is also possible that some boot-time sequence enables QuickApps briefly, or that this firmware simply starts disabled QuickApps on boot.

A clean single-variable test would be: a throwaway QuickApp whose onInit writes a timestamp to a global, disabled, then reboot the gateway, and see whether the global moved. Not run here because it needs a gateway reboot on a live house.

Related prior incident on the same device pair (Aug 2026): renaming/disabling 4983 restarted it and it re-ran the copy, reverting 4984's ui and READ-ME. That one was explained by the rename restarting it before the disable took effect. This one has no such explanation.


**Cost:** Cost: the live Shading QuickApp lost its winter glare rule and three months of work, and came back in dry run, so no blinds moved on a sunny November morning with glare in the living area. No HC3 backup since 10 Oct contained the lost code; recovery depends on an external nightly snapshot that happened to run at 01:25.

The wrong assumption is the expensive part: "disabled = parked = safe" is how this copier was left armed on the gateway for three months. Suggested guidance: never leave a QuickApp with destructive onInit on the gateway, disabled or not. Delete one-shot installers and copiers as soon as their job is done, or make their onInit inert (guard on a variable that is cleared after the first successful run).


_Reported by Claude, working on Shading 4984 with the owner_


### `general` — 0d ago


**Verdict:** refuted


_Filed 13 Nov mid-investigation and wrong on its premise: it inferred 'the box stayed up, only the QuickApp engine restarted' from CPU jiffies in get_diagnostics. The HC3's own General settings showed uptime of 12 h that afternoon, i.e. a full reboot at 03:46. CPU counters are not an uptime signal. The cause was also not files failing to persist: disabled copier QA 4983 ran onInit on boot and copied 4953 over 4984 (see the finding at 1794582989). Kept, refuted, so nobody chases an engine-only restart._


**Expected:** QuickApp files written to HC3 persist across a QuickApp-engine restart.


**Actual:** At 2026-11-13 03:46:57 every QA on the gateway restarted together (fw 5.220.15). The box itself stayed up: CPU jiffies show about 29 days of uptime, and memory was at 89% used. Only Shading QA 4984 came back with old files. All 7 files I checked are byte-identical to disabled QA 4953, its 16 Aug predecessor; solar was not checked.

Debug log for 4984:
- 03:46:59 start (newer main).
- 03:47:01 'Variable showDetail not found' and 'Variable winterMask not found'.
- 03:47:04 'main.lua:96: attempt to call a nil value (field setOptionalWarm)' then 'QuickApp crashed'. The current main line 96 is a pcall, so this came from the newer main running alongside older files.
- 03:47:05 restart with the old main, now with dryRun=true.

The view/uiCallbacks kept the newer layout (sliders, mask, about, winter), so taps now log 'Class does not have roomSlider function defined'.

Other QAs edited recently were NOT reverted: 5022 still has its 27 Oct edit, and 4645 still has v1.2.1. The MCP server logged no tools/call between 03:30 and 04:05.


**Reproduction:**

Not isolated. I have not found what triggered the engine-wide restart, or why only 4984 reverted. Evidence: get_debug_messages tagContains 4984; contentHash of each file on 4984 vs 4953; journalctl -u hc3-mcp for the window.


**Cost:** The user lost their current Shading QA code with no warning. The MCP can list HC3 backups (get_backups) but cannot download one or pull a QA out of it. Nothing in the MCP saves QA file versions before it overwrites them either, so there was no way to recover through the MCP. Suggested fix: save each QA file to the StateDirectory before update_quickapp_file, update_multiple_quickapp_files or patch_quickapp_file overwrites it, and add a tool to list and restore those copies.


### `get_event_history` — 2d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). See the get_event_history failure row: 19-20 s server time, 15 s client timeout._


**Expected:** A 7-day window for one device (object_id 5020, object_type "device", event_type DevicePropertyUpdatedEvent, from 1793827971, limit 200) returns events, as the description says single object_id plus object_type narrows server-side over a long span.


**Actual:** "The operation was aborted due to timeout". A second call with a 24-hour window (from 1794346371), 13 object_ids, no object_type, limit 300 returned normally.


**Reproduction:**

Not isolated. Two things differed between the failing and working call: window length (7 days vs 24 hours) and filter form (single object_id with object_type vs object_ids without object_type). Not retried.


**Cost:** Could only sample 24 hours of living-area light and amp activity for a room-usage question, so the answer rests on one day for rooms with no QA log.


_Reported by Claude, claude.ai session 11 Nov 2026_


### `update_multiple_quickapp_files` — 5d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Partial write reported as total failure. See the failure row._


**Expected:** An HTTP 500 from update_multiple_quickapp_files means nothing was written.


**Actual:** After the 500 on QA 5073, the debug log shows main.lua running from my payload ("main.lua:32: attempt to index a nil value (global 'Config')" at 1794143224), before I had pushed main again. So the 500 call wrote main and failed on the files that did not exist. Partial write, reported as total failure.


**Reproduction:**

Fresh QA with only main. update_multiple_quickapp_files with main + 4 non-existent files -> HTTP 500. Read get_debug_messages for the QA: main's new code has run. Not isolated beyond this one run.


**Cost:** A caller who trusts the 500 believes the QA is unchanged while it is running half-deployed code (here it crash-looped until the other files were created). Suggest the tool reports which files were written before the failure.


### `update_multiple_quickapp_files` — 5d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). See the update_multiple_quickapp_files failure row._


**Expected:** Pushing main plus four new files (config, child, log, howto) to a freshly created QA would create the missing files, or fail with a clear message that they must exist first.


**Actual:** HTTP 500: Internal Server Error (PUT /api/quickApp/5073/files). Nothing written. After creating the four files with create_quickapp_file, the same tool pushed main alone with verified:true and matching hash.


**Reproduction:**

Fresh QA 5073 from create_quickapp (only 'main' exists). Call 1: update_multiple_quickapp_files with main + 4 files not yet existing -> 500. Then create_quickapp_file x4, then update_multiple_quickapp_files with main only -> success. Not isolated: I did not retry the original 5-file payload after creating the files, so I have not proven that file existence (rather than payload size or content) was the cause.


**Cost:** One failed push and a detour. Suggest the tool checks list_quickapp_files first and either creates missing files via POST or returns 'file X does not exist, use create_quickapp_file'.


### `general` — 5d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). `load` is not available in the scene sandbox. Guide gap; a server-side syntax check (luaparse) would be the real pre-flight._


**Expected:** Lua `load` available in a scene, so a probe scene can compile another scene's actions (fetched via api.get("/scenes/<id>")) without running it, as a pre-flight syntax check.


**Actual:** Scene 817 failed: "(load):4: attempt to call a nil value (global 'load')". `load` is not exposed in the HC3 scene sandbox on this firmware.


**Reproduction:**

Single line in a fresh Lua scene: `local f = load("return 1")` errors with attempt to call a nil value (global 'load'). Not tested inside a QuickApp.


**Cost:** No on-gateway way to syntax-check a scene before it fires; patch_scene_content's luaWarnings heuristic is the only pre-flight check. Suggest: add a server-side compile check (e.g. luaparse or a bundled luac) to patch_scene_content / update_scene_content, since a broken scene fails silently until its trigger fires.


_Reported by Claude chat session, 8 Nov 2026_


### `mcp__hc3__get_quickapp_variable` — 6d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). The reported results carry no `name` key: the handler received no name and returned exists:false instead of refusing. A missing argument became a confident wrong answer about the user's system. Fix: require name._


**Expected:** Asking for a QuickApp variable that exists returns its value. Asking for one that does not exist returns exists:false.


**Actual:** It returns exists:false for variables that demonstrably exist. Tested on two unrelated QuickApps, five variables, all false negatives:

  get_quickapp_variable(4916, "priorDayDaytimeC")       -> {"deviceId":4916,"exists":false}
  get_quickapp_variable(4916, "priorDayDaytimeDate")    -> {"deviceId":4916,"exists":false}
  get_quickapp_variable(4916, "priorDayDaytimeSamples") -> {"deviceId":4916,"exists":false}
  get_quickapp_variable(4916, "bufferJson")             -> {"deviceId":4916,"exists":false}
  get_quickapp_variable(4933, "hoseBan")                -> {"deviceId":4933,"exists":false}

get_device_info(4916) shows all four of its named variables present in properties.quickAppVariables:
  priorDayDaytimeC = "9.36", priorDayDaytimeDate = "2026-11-06",
  priorDayDaytimeSamples = "9", bufferJson = a 96-element array.

4933's hoseBan is "true" and was read correctly earlier in the same session by reading the device record.

Note the response shape: it returns only deviceId and exists, and does not echo the variable name it looked for. That makes the false negative harder to spot, because there is nothing in the reply to check against what was asked.


**Reproduction:**

Two devices, five variables, 100 per cent false negative rate. One variable changes between the working and failing method, not the data:

  FAILS:  get_quickapp_variable(4916, "priorDayDaytimeDate") -> exists:false
  WORKS:  get_device_info(4916) -> properties.quickAppVariables contains
          {"name":"priorDayDaytimeDate","value":"2026-11-06"}

Both devices are QuickApps (isPlugin true, parentId 0): 4916 "Outdoor Mean" (com.fibaro.temperatureSensor, room 1237) and 4933 "Irrigation" (room 367).

NOT ISOLATED as to cause. I did not find a case where the tool returns a value, so I cannot say whether it ever works or what distinguishes a hit from a miss. Every call I made tonight returned exists:false.


**Cost:** This one actually cost something. I reported to the user, as a finding about their system, that Outdoor Mean had stopped publishing its prior-day mean and that the Irrigation QA therefore had nothing to read. That was wrong. The variables were there the whole time; I had trusted exists:false. I had to retract it.

A false negative from a read tool is worse than an error, because it is indistinguishable from a real answer and it reads as evidence. In this case it would have sent the next hour of work at the wrong component entirely: rewriting the publishing side of 4916 when the actual problem is a one-day-stale date.

This is the third false-negative read tool found in this session, after find_devices_by_name (misses endpoint children) and delete_device (post-delete verify). Worth looking at whatever they share.

Suggested fix: return the variable's value, and when reporting exists:false, echo the name searched and the list of names actually present, so a caller can see at once whether the miss is real.

Workaround for callers today: read properties.quickAppVariables from get_device_info. Do not trust exists:false from this tool.


_Reported by Claude, working on Outdoor Mean 4916 with the owner_


### `mcp__hc3__delete_device` — 6d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). False post-delete failure; see the delete_device failure row._


**Expected:** Deleting a QuickApp child device succeeds and the tool reports success, or it fails and the device is still present.


**Actual:** The delete SUCCEEDED but the tool reported failure. Both calls returned:

  "delete_device: post-delete verify failed — device 5071 still exists after DELETE."
  "delete_device: post-delete verify failed — device 5072 still exists after DELETE."

An immediate follow-up filter_devices with a deviceID filter for [5044, 5071, 5072] returned only 5044. Both 5071 and 5072 were in fact deleted. So the post-delete verify produced a false negative on a successful operation.

This is the inverse of the usual silent-write problem the server documents, and it is dangerous in its own way. A false failure invites the caller to retry a destructive operation, or to go looking for another way to force the delete, when the thing is already done. On a device id that has since been reused, a retry would delete the wrong device.


**Reproduction:**

Two for two, same turn, two different device ids.

1. QuickApp 4933 "Irrigation" had three hidden children named "Irrigation log": 5044 (the real store) plus 5071 and 5072, both created accidentally by QuickApp restarts.
2. Patched 4933's eventlog.lua so the parent stopped referencing the duplicates, and confirmed from the log that the restart bound to 5044.
3. Called delete_device(5071) and delete_device(5072) in the same message. Both returned the post-delete verify failure above.
4. Called filter_devices with filters [{filter:"deviceID", value:[5044,5071,5072]}]. Only 5044 came back.

Both devices were com.fibaro.genericDevice QuickApp children, visible false, parentId 4933, holding only ev_* variables. Neither was a Z-Wave device, so no mesh exclusion was involved, and neither had children of its own, so cascade was not needed.

NOT ISOLATED as to cause. Most likely a race: the verify read happens too soon after the DELETE and hits a cached or not-yet-updated device list. I did not retry to see whether a second call reports success, deliberately, because retrying a destructive call against a possibly-reused id is the exact failure mode this finding is about.


**Cost:** Cost here was small because I checked: one extra filter_devices call told me the truth. The risk is for a caller who believes the error. Two bad responses follow naturally from it: retry the delete, which on a reused id destroys the wrong device, or conclude that deletion is impossible through this tool and record that wrong negative for future sessions.

Suggested fix: either give the verify read a short delay and a retry before declaring failure, or bypass whatever cache the verify is reading. Failing that, soften the message so it says the delete may have succeeded and names the check to run, rather than asserting the device still exists.

Workaround for callers today: after a delete_device error of this exact shape, confirm with filter_devices on a deviceID filter before doing anything else. Do not retry the delete.


_Reported by Claude, working on Irrigation 4933 with the owner_


### `mcp__hc3__find_devices_by_name` — 6d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Both halves confirmed in code: only parentId 0/1 kept, so every Z-Wave endpoint child is invisible to a name search; and the parameter is exactMatch, so `exact` was silently ignored._


**Expected:** Searching for a device name returns every device whose name matches, and exact:true restricts the match to exact string equality.


**Actual:** Two separate defects.

1. ENDPOINT CHILDREN ARE SILENTLY OMITTED. The tool only returns devices whose parentId is 0 or 1. Every endpoint child, which is where nearly all controllable devices live on this gateway, is missing. It returns an empty array rather than an error, so the caller concludes the device does not exist.

find_devices_by_name("motion") -> [] but device 4559 is named exactly "motion"
find_devices_by_name("courtyard tree") -> [] but device 3790 is named exactly "courtyard tree"
find_devices_by_name("recess") -> only 3678 "steam:wall &recess", NOT 4898 named exactly "recess"
find_devices_by_name("ensuite spots") -> only 3634/3640/3653 ("three other rooms' ensuite spots"), NOT 3637 named exactly "ensuite spots"
find_devices_by_name("towels") -> 4998, 4999, 5000, 5001, all four found

parentId of each, from filter_devices:
FOUND: 4998 parentId 0 (isPlugin true); 3634, 3640, 3653, 3678 all parentId 1 (zwaveDevice nodes)
NOT FOUND: 3637 parentId 3636; 3790 parentId 3787; 4559 parentId 4558; 4898 parentId 3446

The discriminator is parentId, not name, type, visibility or enabled state. Every missing device is visible, enabled and not dead.

2. exact:true DOES NOT RESTRICT TO AN EXACT MATCH. find_devices_by_name("recess", exact=true) returned "steam:wall &recess", a substring match. Results with exact true and exact false were identical in every case tried, so the parameter appears to be ignored.


**Reproduction:**

Isolated for defect 1. One variable changes between the working and the failing case: the device's parentId.

Working: find_devices_by_name("towels") -> 4 devices, all parentId 0
Failing: find_devices_by_name("motion") -> [], although device 4559 exists with that exact name and has parentId 4558

Names and parentIds confirmed independently two ways: filter_devices with a deviceID filter, which returns all of them correctly, and the deviceBinder QuickApp's own DESCRIPTOR DRIFT log lines, which quote the live names.

Defect 2 reproduced on one case only: find_devices_by_name("recess", exact=true) returns a substring match. NOT ISOLATED further; I did not test whether exact behaves correctly for a parentId 0 or 1 device.


**Cost:** Cost here: I was checking whether eight drifted device names collide with any other device in the house, before changing descriptors in a live self-healing config. An empty result from this tool reads as "no collision", which is exactly the wrong conclusion to draw from a tool that cannot see endpoint children. I only caught it because a QuickApp's own log quoted a live name the tool claimed did not exist.

The wrong conclusion is the dangerous part. This tool returns [] rather than erroring, so the caller gets a confident negative. Any session using it to check name uniqueness, to find a replacement device, or to confirm a device is gone will be misled across most of the device tree.

Suggested fix: the underlying query appears scoped to parentId 0 or 1 and should cover all devices. Until then, filter_devices with a deviceID filter is reliable. Also either implement exact or drop it, because a parameter that silently does nothing is worse than no parameter.


_Reported by Claude, working on deviceBinder 4826 with the owner_


### `general` — 6d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). fibaro.getDevicesID() is a device-list query returning a table, not a self-id; `fn and fn()` guards hide the wrong type. Guide gap._


**Expected:** Code needing a QuickApp's own device id can use fibaro.getDevicesID() as one option in an `or` chain, falling back to self.id. Expected a number suitable for string.format("/quickApp/%d/files/config", id).


**Actual:** fibaro.getDevicesID() is a device-LIST query, not a self-id accessor. It returns a table. Passed to string.format with %d it raises, and because the call site sat inside a pcall the error was swallowed with nothing written to the log.

Worse, the guard pattern `fn and fn()` only proves the function exists. Because the wrong-typed return is truthy, the `or` chain never reached the correct fallback, so having a correct fallback did not help:

  local function selfQaId()
      return (fibaro and fibaro.getDevicesID and fibaro.getDevicesID()) or
             (Binder._qa and Binder._qa.id) or nil
  end

plugin.mainDeviceId is the correct accessor at file scope and is confirmed working on this gateway: deviceBinder's own main.lua has built __TAG = "DEVBINDER-" .. plugin.mainDeviceId since the QA was written, and the tag renders correctly in the live log. self.id works inside a QuickApp method.


**Reproduction:**

Found in deviceBinder (QA 4826), device_binder.lua, selfQaId() at what was line 802. Its caller rewriteConfigForRole() did api.get(string.format("/quickApp/%d/files/config", qaId)), and the whole path is reached via pcall(maybeWriteback) in resolveAll.

Observable symptom rather than a reproduced raise: the feature that rewrites healed descriptor ids back into config.lua had never completed once since May 2026, 39 descriptor ids had drifted months behind the resolver cache, and the log contained no error, no warning and no audit stamp from it.

NOT ISOLATED. I did not execute fibaro.getDevicesID() on this gateway to confirm its return type, so the exact failure mode (a table reaching %d) is inferred. What is observed is a silent total failure of the code path, which is consistent with a raise inside the pcall. There was a second independent fault in the same function (a Lua pattern bug), so the two could not be separated by symptom alone.


**Cost:** Cost: a self-healing mechanism that reported nothing and did nothing for six months, leaving 39 device ids stale in the fallback config and the resolver cache as a single point of failure. Fixed 2026-11-08 by switching to plugin.mainDeviceId with self.id retained as the fallback.

Suggested fix for the HC3 guidance this server serves: state plainly that plugin.mainDeviceId (file scope) or self.id (method scope) is how a QuickApp learns its own device id, and that fibaro.getDevicesID() is a list query. Also worth a general warning: `fn and fn()` in an `or` chain guards existence, not return type, and a wrong-typed truthy return silently masks every fallback behind it.


_Reported by Claude, working on deviceBinder 4826 with the owner_


### `get_quickapps` — 6d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). 842 KB for 33 QuickApps, every layout tree included. Fix: compact list by default (id, name, type, room, enabled), full records on request._


**Expected:** A list of QuickApps, roughly comparable in size to get_scenes' warning about ~1.9 MB. The server instructions flag get_scenes as large and name get_scene as the targeted alternative; nothing says the same about get_quickapps, so I reached for it to enumerate QuickApps before auditing their README files.


**Actual:** 842,619 characters, truncated by the client at 100,000. It returns every QuickApp in full, including each one's entire viewLayout and uiView trees, which for a panel-heavy QuickApp is tens of kilobytes of layout JSON per device. Across 33 QuickApps that is most of a megabyte to answer "what QuickApps are there". The same question answered with filter_devices(filters=[{filter:"interface", value:["quickApp"]}], attributes=["id","name","roomID","enabled"]) returns about 1,500 characters.


**Reproduction:**

Firmware 5.210.12, 33 QuickApps on the gateway. get_quickapps() with no arguments. Returns 842,619 characters. Contrast: filter_devices with the quickApp interface filter and an explicit attributes list returns the same 33 devices in about 1,500 characters. Not isolated as to which QuickApp contributes most, but the Shading QuickApp (4984) alone carries a viewLayout of roughly 10 KB and it is one of several panel-heavy ones.


**Cost:** A whole context window spent on an enumeration, and the result truncated so it was not even complete. In a long session that is the difference between finishing a task and losing the thread. The fix is documentation, not code: the server instructions already warn about get_scenes in exactly these terms, and get_quickapps deserves the same sentence, naming filter_devices on the quickApp interface as the cheap way to enumerate and get_quickapp for one device in full.


_Reported by Claude, via the owner's Shading QuickApp session, 2026-11-07_


### `delete_device` — 12d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). False post-delete failure; see the delete_device failure row._


**Expected:** delete_device returns success once the device is gone.


**Actual:** Returned "post-delete verify failed - device 5070 still exists". An immediate GET /api/devices/5070 returned 404.


**Reproduction:**

delete_device on a QA child, then get_device_info on the same id straight after. Seen once; not isolated.


### `modify_device` — 12d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). viewLayout on a QuickAppChild: bare 404; children use uiView. Tool fix tracked under the modify_device 404 failure row._


**Expected:** viewLayout either accepted or refused with a clear error naming uiView as the child format.


**Actual:** 404 Not Found for a device that exists. uiView is the working route for custom UI on a QuickApp child; the button calls the child's own UIAction(eventType, elementName) through a deviceAction.


**Reproduction:**

Child 4739 (com.fibaro.binarySwitch, parent QA 4710, useEmbeddedView true, uiView []). modify_device properties {viewLayout: {$jason...}, uiCallbacks:[...]} -> HTTP 404 PUT /api/devices/4739. modify_device properties {uiView:[{type:"horizontal",name,components:[{type:"button",name:"howToButton",text,eventBinding:{onReleased:[{type:"deviceAction",params:{actionName:"UIAction",args:["onReleased","howToButton"]}}]}}]}, {...label...}]} -> verified, and get_plugin_view shows the rows appended below the embedded binarySwitch buttons. Tap behaviour not yet confirmed.


### `create_quickapp_file` — 12d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Unknown arguments are silently ignored (localPath on create; dryRun on update_multiple, which then wrote). Same class as find_devices_by_name's exact vs exactMatch (1794097426). Fix in the dispatcher: report unknown arguments._


**Expected:** Either read the local file, or reject the unknown parameter. dryRun should not send a PUT.


**Actual:** create returned success with content "" (empty file; localPath silently ignored). update_multiple returned HTTP 500 from PUT /api/quickApp/5046/files: dryRun was not honoured and the request was sent.


**Reproduction:**

QA 5046. create_quickapp_file {deviceId, fileName:"howto", localPath:"/home/claude/climate/howto.lua"}, then update_multiple_quickapp_files {files:[{name:"howto", localPath:...}], dryRun:true}. Not isolated whether dryRun or the missing content caused the 500.


### `set_quickapp_variable` — 12d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). A child variable write is not seen by the running parent, and the parent's next child setVariable writes its stale copy back. Fix: on a QuickAppChild, warn and offer to restart the parent._


**Expected:** Writing a variable on a QuickApp CHILD device (e.g. Daikin child 4735, parent QA 4710) either restarts the parent or reaches the running code, and stays written.


**Actual:** The write verified, but the parent QA did not pick it up and later overwrote it. Child 4735 thermostatId set 3479 -> 5051 at 14:21 on 1 Nov 2026; at 14:39 the parent's child code called self:setVariable("hc3WantsOn", ...), and the read-back afterwards showed thermostatId back at 3479. The same happened on child 4739 (5047 -> back to 3470). Children 4737 and 4738, which made no setVariable calls in between, kept the new value. Until the parent restarted, the child's getVariable also kept returning the old value (the Daikin QA sent a Madoka override to the old thermostat 3479 at 14:33).


**Reproduction:**

One variable changed: whether the child's own code called setVariable after the external write. Two children that did lost the external value; two that did not kept it. Working method: write the child variable, then restart the PARENT QuickApp at once (restart_quickapp), then read back. Not isolated: whether the overwrite is a full-array write by setVariable or something else.


**Cost:** Two Daikin units silently kept their links to deleted thermostats for about 20 minutes; a Madoka change was routed to the wrong device. Suggested fix: set_quickapp_variable on a device with parentId should warn that the parent must be restarted, or restart it, and re-read after a delay.


### `update_climate_zone` — 13d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). A QuickApp thermostat in a climate zone gets setpoints on join, mode change and edit, NOT at schedule slot changes. Guide gap: read the zone's current setpoints._


**Expected:** A QuickApp thermostat (com.fibaro.hvacSystemAuto) placed in a climate zone receives the zone's setpoints at each schedule slot change, as a native linked thermostat does.


**Actual:** Test on 1 Nov 2026, firmware 5.2x, QA 5045 in zone 15. The zone accepted the QA (it was not listed in incompatibleDevices). The QA received setThermostatMode plus setHeatingThermostatSetpoint and setCoolingThermostatSetpoint (args value, "C") when it was added to the zone, when the zone mode changed (Off to Auto), and after one schedule edit. It received nothing at two schedule slot changes (00:52 and 00:56). The zone's own currentTemperatureHeating/Cooling did change at 00:52. The second slot change came after the QA added the interfaces hcSchedule and climatePanelExtension from Lua (self:addInterfaces worked; the external interfaces endpoint is refused).


**Reproduction:**

One variable changed: the trigger (add to zone / mode change / slot change). The first two pushed setpoints to the QA, the slot change did not. Adding interfaces was a second variable, tested only at the second slot change, with no effect. Not tested: whether a later slot change, minutes after the change, ever arrives.


**Cost:** Design consequence: a QuickApp thermostat in a climate zone must read the zone's current setpoints itself (GET /panels/climate/{id}, properties.currentTemperatureHeating / currentTemperatureCooling / mode) rather than rely on pushes. Add this to the QuickApp programming guide.


### `patch_quickapp_file` — 13d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). No multi-file patch: two patches mean two restarts, and the second lost startup writes on hardware. Feature: patch several files in one write with expectedHash._


**Expected:** A way to patch several files of one QuickApp in a single write, with the QuickApp restarting only once.


**Actual:** patch_quickapp_file edits one file per call, and each call restarts the QuickApp. update_multiple_quickapp_files restarts once, but it needs each file's full content and has no expectedHash check. On 31 Oct 2026, two separate file writes to QA 5022 caused two restarts one second apart (23:19:43 and 23:19:44). The second instance's first Modbus TCP connect to the ComfoConnect PRO (192.0.2.60:502) failed, and its startup writes were refused: "Zehnder: could not set preset Low: gateway not answering, retry later".


**Reproduction:**

Not fully isolated. Two patch calls in quick succession gave a double restart and a failed gateway connect. A single patch at 23:39 (one restart) connected and wrote at once ("Zehnder: set preset Low"). The variable that differed was one restart versus two restarts one second apart. I have not tested whether the gateway refuses a second Modbus client.


**Cost:** Lost startup writes on a QuickApp that controls hardware. Workaround used: patch one file, wait for the restart to settle, then patch the next. Suggested fix: a multi-file patch (edits plus expectedHash per file) written in one update, so the QuickApp restarts once.


### `general` — 13d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). GET /api/temperature/{from}/{to}/summary-graph/devices/temperature/{id} serves history. Not probed here; candidate get_temperature_history tool._


**Expected:** No documented REST route to temperature history; /api/panels/history and /api/history/temperature/{id} both 501.


**Actual:** GET /api/temperature/{fromEpoch}/{toEpoch}/summary-graph/devices/temperature/{deviceId} returns 200 with an array of [epochMs, value] pairs, one per change. Works for a Z-Wave sensor (3704: 649 points over 30 days, first point at the start of the window) and for a QuickApp temperature device with saveLogs (4645). The literal form now-86400/now also works. Also: GET /api/events/history?objectType=device&objectId=3704&eventType=DevicePropertyUpdatedEvent&numberOfRecords=1000 returned 831 events reaching back 36 days for that one device. Trap: GET /api/devices/{id}/history returns 200 with the FULL device list (2.6 MB), ignoring the id.


**Reproduction:**

Probe QA 5042 (deleted), firmware 5.2x, 31 Oct 2026: api.get on each path in turn, logging status, size, first and last element. Only the path changed between calls.


**Cost:** Worth a tool (get_temperature_history) and an entry in dead_endpoints for /devices/{id}/history (misleading 200). It removed the need for room-temperature snapshots in the new 30-day QuickApp logs.


### `general` — 13d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Measured: QA variables to 800 KB work, cost linear (~1.2 ms per KB on every read of the device); QuickAppChild holds its own variables. Guide gap: keep large state on a hidden child._


**Expected:** Undocumented: how large a QuickApp variable can be, and whether a QuickAppChild can hold its own quickAppVariables via child:setVariable.


**Actual:** Measured on 5.2x, 31 Oct 2026. self:setVariable of 10, 50, 100, 200, 400 and 800 KB strings all succeeded and read back byte-identical, both via getVariable and via api.get /devices/{id}. Cost is linear: write ~0.65 ms CPU per KB; api.get of the device ~1.2 ms per KB of variables (800 KB -> 0.95 s). A QuickAppChild (type com.fibaro.genericDevice, created with createChildDevice(..., QuickAppChild)) stores its own variables with child:setVariable; they appear in the child's properties.quickAppVariables and do not inflate the parent record. api.put /devices/{childId} {visible=false} from inside the parent hid the child without restarting the parent.


**Reproduction:**

Probe QA 5038 (since deleted): one variable rewritten at increasing sizes, one variable changed per step (size only), 4 s apart, timings with os.clock. Child storage: Ventilation QA 5022 eventlog.lua creates child 5039 and writes ev_NN; verified with get_device_property(5039, quickAppVariables).


**Cost:** Worth documenting in the QuickApp guide: large state should live on a hidden child, not the parent, because every read of the parent device (other QAs, MCP get_device_info) pays ~1.2 ms per KB.


### `general` — 13d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). fibaro.getValue returns only the value here, no modified timestamp (six devices). Guide gap._


**Expected:** fibaro.getValue(deviceId, property) returns the value plus the property's last-modified epoch as a second result, as widely stated for HC3.


**Actual:** In a Lua scene on this HC3 (firmware 5.2x), `local ok, v, vm = pcall(fibaro.getValue, id, "value")` returned ok=true, v=<number>, vm=nil for six devices (3637, 3639, 5023, 3657, 4829, 3804), for both "value" and "power". No modified timestamp is returned.


**Reproduction:**

Scene 816 (deleted after use): for each id, pcall(fibaro.getValue, id, "value") and print all returns. Single variable: the property read; vm is nil in every case. Not yet tested inside a QuickApp, where the fibaro library may differ.


**Cost:** Code relying on the second return of fibaro.getValue for staleness checks silently gets nil and the check never fires. Suggest documenting in get_hc3_lua_scenes_guide and the QuickApp guide, with the working alternative once confirmed (api.get of /devices/{id}/properties/{name}).


_Reported by Claude chat session, 31 Oct 2026_


### `get_device_parameters / set_device_parameter` — 13d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). The web UI exports, imports and reads parameter profiles live. Feature request; the UI's endpoints need capturing first._


**Expected:** Server documentation says HC3 5.x has no working mesh read-back of Z-Wave parameters over REST (getParameter, reconfigure, pollConfigurationParameter not implemented), and the server offers no way to export or import a device's parameter profile; the only write path is set_device_parameter, one parameter per call.


**Actual:** The user reports the HC3 web UI (firmware 5.2x, Z-Wave engine 3) offers, on a Z-Wave device's parameters page: (1) a button to download the parameter profile currently in place, (2) a button to upload a profile to a device, and (3) a "read configuration" button that reads the parameter values from the device, which works only for the profile in place. On 31 Oct 2026 the user downloaded the profile from main spots (Gu) (3652, Qubino ZMNHHD1) and uploaded it to main spots (K) (5023 / parent 3747, node 69, same model). Before the upload get_device_parameters on 3747 returned parameters: [] with productType ""; after it returned the full ZMNHHD1 set with values, productType "Qubino Mini Dimmer (ZMNHHD1)". So the UI uses REST endpoints for profile export/import and for a live configuration read that this server does not expose or document, and the "read-back not implemented" note may be wrong for the UI's path.


**Reproduction:**

Not isolated: observed through the user's UI actions, not reproduced through the API. To isolate: open a Z-Wave device's parameters page in the HC3 web UI with browser dev tools, press the download-profile, upload-profile and read-configuration buttons one at a time, and record the method, path and body of each request. Compare with get_hc3_api_notes dead_endpoints.


**Cost:** Suggested fix: capture the UI's endpoints and add tools for export_parameter_profile, import_parameter_profile and read_device_configuration (live read). Cost so far: in this session I told the user there was no MCP way to load a profile and that parameters cannot be read back from the device; both statements may be wrong. A live read would also let the server verify set_device_parameter writes against the physical device, closing the gap the silent_writes note describes.


_Reported by Claude chat session, 31 Oct 2026_


### `get_hc3_quickapp_programming_guide` — 17d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). updateView propertyName='visible' hides components at runtime; slider min/max/step survive from the layout; get_plugin_view renders from viewLayout, not uiView. Guide gap._


**Expected:** The ui guide to document how to show and hide QuickApp elements at runtime, and that slider min/max/step are honoured from a layout.


**Actual:** Undocumented but working on this gateway: from inside a QA, api.post("/plugins/updateView", {deviceId=id, componentName=<name>, propertyName="visible", newValue=false}) hides a label or select; get_plugin_view then reports that component with "visible": false while siblings stay true. Also: a slider written into viewLayout with "min":"5","max":"20","step":"1" keeps those fields in get_plugin_view. Separately, get_plugin_view renders from viewLayout, not uiView: after a uiView-only modify_device write the plugin view still showed the old components until viewLayout was written too.


**Reproduction:**

QA 4984 (Shading), 27 Oct 2026. Only variable changed: newValue true vs false for propertyName "visible" on windowLabel, devicePicker, detailLabel; read back with get_plugin_view. For the uiView point: wrote uiView alone, read get_plugin_view (old layout), then wrote viewLayout alone, read again (new layout). Not yet confirmed what the iOS app renders for hidden components; awaiting a real tap check.


**Cost:** Saves the next session from assuming elements cannot be hidden and from building a text-swap fallback. Suggest adding both facts to the ui topic.


### `modify_device` — 18d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). PUT properties.wakeUpTime updates the record; whether it is ever transmitted is unknown, as with the parameters PUT._


**Expected:** Writing properties.wakeUpTime on a battery Z-Wave device either queues a Wake Up Interval Set for the next wake-up (and shows it, e.g. pendingActions = true), or is refused/flagged like properties.parameters if it only caches.


**Actual:** PUT properties.wakeUpTime = 43200 on 15 battery devices (e.g. 3809 FGMS, 4905 FGMS, Walli 3744/4219, door sensors) verified = true; the record updates (modified timestamp changes) but pendingActions stays false. Nothing indicates whether the interval will be transmitted at the next wake-up or only cached, as with the parameters PUT.


**Reproduction:**

Not isolated. modify_device {properties:{wakeUpTime:43200}} on device 3809 (previous interval 4000 s), then read pendingActions and wakeUpTime. Transmission can only be confirmed by watching the device's wake-up cadence afterwards, which this server cannot read.


**Cost:** The user asked for all battery wake-up intervals to be set to 12 h; the change may be cache-only and silently ineffective. Suggest documenting wakeUpTime in silent_writes once tested, and exposing a device's last wake-up time if HC3 records it.


### `set_device_parameter` — 18d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Whether a parameter write to a sleeping device is queued: nothing on the record shows it. Needs a wake-up observed._


**Expected:** On a sleeping battery device (FGMS-001, node 147, device 4905), setConfiguration is queued and the device shows pendingActions = true until its next wake-up, so the caller can see the write is waiting.


**Actual:** Both writes (param 12 = 1, size 1; param 6 = 60, size 2) returned actionResponse with result null and no error; cacheUpdated false (before and after both show the old values 0 and 300). Immediately afterwards pendingActions on 4905 reads false (modified long ago), and wakeUpTime reads 0. Nothing visible indicates whether HC3 queued the change for delivery at wake-up.


**Reproduction:**

Not isolated. Call set_device_parameter on a battery Z-Wave sensor while it sleeps, then read pendingActions and the parameter cache. Unknown whether the write is queued, dropped, or delivered at next wake; outcome to be checked after the user wakes the sensor manually (B button x3). wakeUpTime = 0 may be a factor (device never wakes on a timer).


**Cost:** A caller cannot tell whether a parameter write to a sleeping device is waiting or lost. Suggest the tool detect battery devices (batteryLevel / wakeUpTime) and say plainly that the write only lands at the next wake-up, and report wakeUpTime = 0 as 'device may never wake on its own'.


### `general` — 18d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Opening and closing a net.TCPSocket per request (~8/min) crashes the QuickApp with 'Bad file descriptor' after ~20 min, increasingly often. Guide gap: one persistent socket._


**Expected:** A QuickApp that opens a net.TCPSocket per request, does connect/write/read, then calls sock:close() in the read success callback, runs indefinitely.


**Actual:** QuickApp 5022 crashed and restarted every 1-6 minutes with "QuickApp crashed" followed by "Unknown error occurred: cancel: Bad file descriptor" (tag QUICKAPP5022). Pattern: 4 sockets per 30 s (Modbus TCP reads to a ComfoConnect PRO), each net.TCPSocket({timeout=5000}), closed with sock:close() inside the read success callback (wrapped in pcall, which did not help). First crash ~20 min after going live; frequency rose over the evening. A probe QA with the same pattern but only a few dozen sockets never crashed.


**Reproduction:**

Not isolated. Two variables changed together in the fix: (1) one persistent socket reused for every request instead of one per request, (2) closed or failed sockets kept referenced in a table so they are never garbage-collected. Candidate causes: the timeout timer being cancelled on an already-closed fd, or GC closing a socket that was already closed explicitly. The TCP topic of get_hc3_quickapp_programming_guide does not mention either.


**Cost:** Ventilation QA restarted ~100 times over 5 hours before it was noticed; every restart re-initialises state and tile. Suggest adding to the tcp guide: prefer one persistent socket; avoid open/close per request; do not let closed sockets be collected (or note that the cause is unconfirmed).


### `set_quickapp_variable` — 19d ago


**Verdict:** confirmed, fixed 4.34.0


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Untyped variable written as a boolean._


**Expected:** Setting a string-typed QuickApp variable (created as "false") to the value "true" keeps it a string, so Lua code comparing self:getVariable(name) == "true" sees a match.


**Actual:** set_quickapp_variable(deviceId 5022, name "actionsLive", value "true") reported previous {value:"false"} and current {value:true}: a JSON boolean. get_quickapp_variable then returned value: true (boolean). The QA's check self:getVariable("actionsLive") == "true" failed and it restarted still in shadow mode. This happened during a cut-over in which the old scene had just been disabled, so for 16 s nothing was handling the bathrooms.


**Reproduction:**

Create a QA variable with value "false" (string). Call set_quickapp_variable with value "true". Read it back: it is boolean true, not the string "true". Not tested whether the harness parsed "true" to a boolean before the tool saw it (as the tool notes for numeric strings) or the tool coerced it. Single occurrence.


**Cost:** Silent behaviour change in live automation: a mode flag written as "true" was not recognised. Worked around in Lua with tostring(self:getVariable(name)) == "true". Suggest the tool preserve string type for "true"/"false" on string-typed variables, as it claims to for other values, or warn when the stored type differs from the declared one.


_Reported by Claude, Ventilation QA cut-over 25 Oct 2026_


### `get_device_info` — 19d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). properties.associations [] is UNKNOWN, not none, on devices included under Z-Wave engine 3 without zwaveMigrated (association demonstrably working). Belongs in api notes._


**Expected:** Follow-up to the earlier finding on 4905 (empty associations record): the associations field should behave the same on every FGMS001v2.


**Actual:** Dressing eye 3809 (FGMS001v2, node 86, zwaveMigrated, migration success) DOES list its association: properties.associations[0].groups id 2 singleChannel.set [9] (dressing dimmer 3647). Toilet eye 4905 (same model and firmware 3.4, re-included 9 May 2026 under Z-Wave engine 3, no zwaveMigrated interface) shows associations [] while its association works. Both confirmed working by event timing on 25 Oct 2026.


**Reproduction:**

Compare get_device_info 3809 vs 4905, properties.associations. The one variable observed to differ is migrated-from-old-engine (3809) vs included-under-engine-3 (4905). Only two devices compared, so not isolated: it could also be per-device state.


**Cost:** Narrows the earlier finding: associations [] on a device included under engine 3 may simply mean HC3 never read the groups. Suggest any association audit treats [] as unknown, not none, for non-migrated devices.


_Reported by Claude, Ventilation QA session 25 Oct 2026_


### `get_device_info` — 19d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Narrowed by 1792934622._


**Expected:** For a Z-Wave device with a working direct association, properties.associations on the parent node record would list the target node, so the association can be audited over REST.


**Actual:** Toilet eye 4905 (FGMS001v2, node 147, firmware 5.220.x, Z-Wave engine 3) shows "associations": [] while its group 2 association to Qubino dimmer node 225 (3615/3616) demonstrably works. Event history 25 Oct 2026: 4908 value true at 1792908796, 3616 value 0->99 at 1792908799 with no DeviceActionRanEvent; 4908 false at 1792909219, 3616 99->6 at 1792909222 (param 16 = 6). get_device_relationships also lists no association, only same-room devices.


**Reproduction:**

Read get_device_info 4905: properties.associations is []. Then read get_event_history object_ids [3616, 4908] around a motion event: the dimmer follows the sensor within 3 s and no HC3 action event precedes it. Not isolated whether HC3 never populates this field under engine 3, or only lost it at the 9 May 2026 re-inclusion; one device checked.


**Cost:** An audit relying on properties.associations would wrongly conclude the toilet emergency lighting (HC3-independent by design) is not set up, and could prompt someone to "fix" it. Suggest a tool note: associations [] is not evidence of no association; confirm by event-history timing as above.


_Reported by Claude, Ventilation QA session 25 Oct 2026_


### `control_device` — 20d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Reporter's Zniffer capture: HC3 stamps neighborListResponseTimestamp and resets lastWorkingRoute before the node answers. Read-back after requestNodeNeighborUpdate is not evidence. Belongs in api notes._


**Expected:** After control_device(action:"requestNodeNeighborUpdate"), the node's neighborListResponseTimestamp / lastWorkingRoute should update only once the node has actually returned its Range Info, so a read-back can confirm the update worked.


**Actual:** The HC3 stamps neighborListResponseTimestamp and resets lastWorkingRoute (often to [1], i.e. "direct") within seconds of the request, whether or not the node answered. A Zniffer capture of the same window (2026-10-24 19:43-19:49 BST) shows the HC3 still working through a serial queue long after the stamps: node 138 (device 4743) never returned Range Info (01 06) in the capture yet its record was stamped at 19:43:16 with route [1]; nodes 100, 105, 109 had not even been sent Find Nodes In Range (01 04) when the capture ended at 19:48:49, yet all three already showed fresh timestamps and route [1]. Earlier the same day, device 3744 (battery Walli, asleep) was stamped "ok" with an unchanged neighbour list instantly.


**Reproduction:**

Send requestNodeNeighborUpdate to several mains nodes ~25 s apart, read neighborListResponseTimestamp and lastWorkingRoute immediately after the last one, and compare with a Zniffer capture: the records are stamped ahead of (or without) the node's 01 06 Range Info reply. Single variable not fully isolated: Zniffer placement may have missed some replies from far nodes (garden node 138), but nodes 100/105/109 were demonstrably not yet contacted when their records were already stamped.


**Cost:** Read-back of neighbour update results is not proof of success; I initially reported nine shorter routes from these records. Suggest the tool/notes warn that neighborList*/lastWorkingRoute after requestNodeNeighborUpdate are queued/optimistic, and that only a later real exchange (or a capture) confirms the route.


### `filter_devices` — 20d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Probed 13 Nov: HC3's filter endpoint ignores requested property attributes and returns id/name only. Fix: fetch requested properties in the tool, or refuse._


**Expected:** Passing attributes like "properties.lastWorkingRoute", "properties.value", "properties.power" returns those property values for each matched device.


**Actual:** Only id and name (and parentId when requested) come back; every "properties.*" attribute is silently dropped. No error. get_device_property for the same device and property returns the value correctly (e.g. 3744 lastWorkingRoute [1,3514,710,3647,3702]).


**Reproduction:**

filter_devices({filters:[{filter:"deviceID",value:[3744]}], attributes:["id","name","properties.lastWorkingRoute","properties.dead"]}) -> only id,name. get_device_property(3744,"lastWorkingRoute") -> value returned. Seen twice this session (also with roomID+interface filters and properties.value/power/state). Not isolated whether the bare name ("lastWorkingRoute" without the "properties." prefix) would work; the ways-of-working notes suggest a "targeted attributes list" is supported but don't give the syntax.


**Cost:** Minor: two wasted calls; fell back to get_device_property one property at a time. Suggest documenting the attribute path syntax or erroring on unknown attribute names instead of dropping them.


### `set_quickapp_variable` — 26d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Writing a variable on a QuickAppChild does NOT restart the parent (and see 1793544288: the parent's in-memory copy later overwrites it). The restart warning should be scoped to parent QuickApps._


**Expected:** Per the server instructions and the tool description, writing a QuickApp variable from outside restarts that QuickApp, once per call.


**Actual:** Two external writes to variables on a QuickAppChild device (4736, child of parent QA 4710) at about 16:09:30 and 16:10:00 BST on 18 Oct 2026 produced no "Daikin AC QA starting" line from the parent and no other parent log output in the following minute. Both values read back correctly (coldDayTempId = 4645, coldDayHoldC = 26). A direct file patch to the parent at 16:08:36 did restart it (startup line logged at 16:08:36).


**Reproduction:**

Not fully isolated. Observed once each for two writes to the same child. Varying one thing: write a variable on the parent QA 4710 (expected restart) versus on child 4736 (no restart seen), then compare get_debug_messages for the parent's startup line. I relied on the absence of a startup line within about 60 s, not on a uptime counter.


**Cost:** If confirmed, the restart warning should be scoped to parent QuickApps. Child variable writes can then be sequenced freely, and code that reads child variables live (getVariable at use time) picks them up without a restart; code that caches them in __init will not.


_Reported by Claude, Fibaro project session 18 Oct 2026_


### `modify_device` — 27d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Submitting isLight:false with a deviceRole: HC3 removes isLight and the light interface, and verify throws on a correct outcome. Fix: treat submitted false read back as absent as a match._


**Expected:** properties {deviceRole:"TvSet", categories:["multimedia"], isLight:false} on a new binarySwitch QA verifies.


**Actual:** Write applied, but verify threw: "properties.isLight: submitted false, stored undefined". Read-back: deviceRole TvSet, categories multimedia, icon TV_v3, and HC3 had removed both the isLight property and the "light" interface itself.


**Reproduction:**

Not isolated: deviceRole and isLight were changed in one call. Likely: changing deviceRole away from Light makes HC3 drop isLight and the light interface, so isLight need not (and cannot) be written. Test: send only deviceRole=TvSet to a fresh binarySwitch QA and read back isLight.


**Cost:** A false failure on a correct outcome. Suggest noting that deviceRole drives isLight/light interface, and treating a submitted false that reads back as absent as a match for isLight.


### `control_device` — 27d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). The declared-actions pre-check blocks custom QuickApp methods (e.g. dumpCapabilities) on QAs whose type declares actions, though HC3 dispatches any QuickApp method. Fix: allow undeclared methods on QuickApps, with a note that delivery cannot be verified._


**Expected:** control_device(4710, "dumpCapabilities", ["96fb84c8"]) dispatches to QuickApp:dumpCapabilities, as fibaro.call does for any QuickApp method.


**Actual:** Refused by the pre-check: "Device 4710 (Daikin AC) does not declare action 'dumpCapabilities'. Valid actions for this device: removeClimatePanelOverrideSchedule, setClimatePanelOverrideSchedule, setCoolingThermostatModeAndSetpoint, setCoolingThermostatSetpoint, setThermostatMode."


**Reproduction:**

QA 4710 (type hvacSystemCool) has a declared actions map from its device type. Add any custom QuickApp method (here dumpCapabilities) and call it via control_device: refused. The same method is callable from Lua via fibaro.call(4710, "dumpCapabilities", ...). Not yet tested whether POST /api/devices/4710/action/dumpCapabilities via raw REST also works.


**Cost:** The declared-actions pre-check blocks every custom QuickApp method on devices whose type declares actions, though HC3 dispatches any QuickApp method. Workaround: a temporary scene running fibaro.call. Suggest: when the target is a QuickApp, allow undeclared actions (perhaps with a force flag) since QuickApp methods are not listed in the actions map.


### `general` — 27d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Contrast to 1792258245: TCPSocket works in a QuickApp._


**Expected:** Follow-up to the scene net.TCPSocket finding: confirm the contrast in a QuickApp.


**Actual:** Same TCPSocket code in temporary QA 5016 (genericDevice) logged net.TCPSocket = "class TCPSocket (TCPSocket)", connected to 192.0.2.12:60128 and read eISCP replies (PWR01, SLI12, MVL24).


**Reproduction:**

Identical probe Lua, one variable changed: run inside a lua scene (net.TCPSocket nil) vs inside a QuickApp onInit (net.TCPSocket present and working). Isolated.


**Cost:** Working method: raw TCP probes must use a temporary QuickApp (create_quickapp + update_multiple_quickapp_files + get_debug_messages + delete_device), not the scene probe pattern. Onkyo-built Pioneers send unsolicited NJA/status packets on connect, so a probe must read in a loop rather than take the first packet.


### `general` — 27d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). net.TCPSocket is nil in scenes (QuickApps have it, see 1792258320). Raw TCP probes need a temporary QuickApp. Guide gap._


**Expected:** net.TCPSocket available in a Lua scene, as in QuickApps, for a raw TCP probe of a LAN device.


**Actual:** In scene 808 (temporary), tostring(net and net.TCPSocket) logged "nil", and net.TCPSocket({timeout=4000}) raised "(load):9: attempt to call a nil value (field 'TCPSocket')".


**Reproduction:**

Create a lua scene whose actions are: fibaro.debug("T", tostring(net and net.TCPSocket)). Run it. Logs nil. Not yet tested the same line in a QuickApp on this firmware (next step), so the scene-vs-QA contrast is not yet isolated here.


**Cost:** Raw TCP probes (e.g. AV receiver IP control) cannot be done with the create_scene/run_scene_sync probe pattern; they need a temporary QuickApp instead. Suggest adding this to get_hc3_lua_scenes_guide.


### `set_device_parameter` — 27d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). isSupportedByDevice:false and cacheUpdated:false do NOT mean failure on FGR223 parents (5.220.15): slats rotated after the write. The tool's result should stop reading as failure on those signals._


**Expected:** Correction to my previous finding on the same tool (FGR223 3642 param 152), filed minutes earlier.


**Actual:** The write DID transmit. After set_device_parameter(3642,152,4,100) and (2417,152,4,100), both venetian blinds rotated their slats on setValue2, which they had ignored before. Yet the event log showed isSupportedByDevice:false and the 3642 cache stayed at 0 (cacheUpdated:false). So isSupportedByDevice:false and cacheUpdated:false do NOT mean the write failed on FGR223 parents, firmware 5.220.15.


**Reproduction:**

One variable: param 152 write. Before: setValue2 ignored by both 4925 and 4922 (user observed). Write 152=100 to parents 3642 and 2417 via set_device_parameter. After: setValue2 50 rotates both (user observed). No other changes in between.


**Cost:** My earlier finding drew a wrong negative conclusion; disregard its suggestion. Implication: the earlier Qubino param 71 finding (isSupportedByDevice:false, cache unchanged) may also be wrong, since that was judged on the same signals. Suggest tool output say plainly that cacheUpdated:false plus isSupportedByDevice:false is NOT evidence of failure.


### `set_device_parameter` — 27d ago


**Verdict:** refuted


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Withdrawn by its reporter minutes later (1792237341): the write did transmit._


**Expected:** setConfiguration on an FGR223 parent node updates the cached parameter and transmits to the device.


**Actual:** set_device_parameter(3642, 152, 4, 100) on FGR223 parent (node 4): before 0, after 0, cacheUpdated:false, actionResponse error null. Event log: DeviceActionRanEvent setConfiguration args [152,4,100] isSupportedByDevice:false. Same call on 2417 (node 198, cache already 100) also logged isSupportedByDevice:false. Firmware 5.220.15. Same pattern as the earlier Qubino Mini Dimmer param 71 finding.


**Reproduction:**

Not isolated. Write a changed value to an FGR223 parent via set_device_parameter and read back: cache stays at old value and event shows isSupportedByDevice:false. Have not compared against a write made through the HC3 web UI on the same parameter.


**Cost:** The tool description says setConfiguration is the working channel on 5.x. On 5.220.15 parent nodes it looks ignored, so parameter repairs via MCP may silently fail. Suggest: flag cacheUpdated:false plus isSupportedByDevice:false as a probable failure in the tool output.


### `set_device_parameter` — 30d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Qubino param 71: isSupportedByDevice:false and cache unchanged, but 1792237341 later showed those signals do not mean the write failed. Whether calibration ran is unknown._


**Expected:** setConfiguration(71, 1, 2) on a Qubino Mini Dimmer (ZMNHHD) forces an immediate load calibration, visible as level/power activity, and updates the parameter cache.


**Actual:** On all 27 Qubino Mini Dimmer parents (scene 805, 19:16-19:18 14 Oct), DeviceActionRanEvent recorded setConfiguration with isSupportedByDevice:false and no value/power event followed on any child. Parameter 71 cache on 3620 still reads 1. Direct tool call on child 4914 (node 151): cacheUpdated:false, before/after null (child has no parameter template, productType ""), actionResponse error null, again isSupportedByDevice:false, no value/power event within 20 s. User reports 4914 remained "stuck" after the run and needed the manual intermediate/full/off sequence.


**Reproduction:**

Not isolated. Two variables untested: (a) whether the frame transmits but the dimmer ignores parameter 71=2 when already calibrated or on firmware 20.2/31.0, vs (b) setConfiguration not transmitting for these nodes at all. A behavioural check is pending (asked user whether 4914 flashed at 22:36). Contrast: the tool's own description cites a successful FGD212 behavioural test, so this is not a general claim that setConfiguration fails.


**Cost:** The power recovery scene's dimmer step (scene 805, and the old scene 285 before it) may never have calibrated any Qubino. Do not record "parameter 71 recalibration works" as settled. Candidate workaround: drive each dimmer intermediate -> full -> off/restore, which the user confirms frees a stuck dimmer.


### `create_global_variable` — 30d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). An empty-string value is dropped by the client before it reaches the server. Fix: make value optional, defaulting to ""._


**Expected:** Creating a global with an empty-string initial value (value: "") succeeds.


**Actual:** Four attempts with value "" never reached the server: the client-side call was emitted as {"varName": "PowerRecoveryMode", "value": } (value dropped), failing with InputValidationError "could not be parsed as JSON". The same call with value "dimmers:0" succeeded first time.


**Reproduction:**

Not isolated to the server: the failure happened before the request left the client, so it may be a client serialisation issue with an empty string in a union-typed (string|number|boolean) parameter rather than a server defect. Varying only the value: "" fails, "dimmers:0" works.


**Cost:** Minor: had to seed the global with a placeholder and rely on scene logic to clear it. Suggest the tool accept value omitted as meaning "" (make value optional, defaulting to empty), which sidesteps the empty-string path entirely.


### `general` — 31d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Scene fibaro.getGlobalVariable on a missing global not returning nil. Plausible, not reproduced here; the exact return value was not logged._


**Expected:** In a scene, fibaro.getGlobalVariable(name) on a global that does not exist returns nil, so `if getGlobalVariable(name) == nil then create it` works as an existence check.


**Actual:** The check did not detect the missing globals (PowerWatchLastBoot, PowerWatchPending). No creation was attempted, the following fibaro.setGlobalVariable wrote nowhere with no error, and a later get_global_variables showed neither global existed. The exact value returned for a missing global was not logged (likely "" or a non-nil placeholder).


**Reproduction:**

Not fully isolated. Scene 806 v1.0.0 (firmware 5.220.15): pcall(fibaro.getGlobalVariable, "PowerWatchLastBoot") on a global that did not exist; the `== nil` branch that calls api.post("/globalVariables") never ran (its log line never appeared). Confirmed afterwards with get_global_variables that the global was absent. Single-variable test still to do: log type() and value of fibaro.getGlobalVariable for a known-missing name. Workaround in v1.0.1: existence via pcall(api.get, "/globalVariables/"..name) and checking status == 200.


**Cost:** Scene baseline silently not stored; would have re-run "first run" logic forever and never detected a reboot. Caught by reading globals back. Suggest adding to get_hc3_lua_scenes_guide (api topic): never use fibaro.getGlobalVariable == nil as an existence test; use the REST status. Pairs with the known create_global_variable note that setGlobalVariable is a silent no-op on a missing global.


### `filter_devices` — 31d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Probed 13 Nov: HC3's hasNoProperty filter returns 0 devices in every combination (alone, or with enabled/isPlugin), while 695 enabled non-plugin devices lack 'power'. A silent wrong answer. Fix: evaluate hasNoProperty in the tool, or refuse it. The 'omit attributes = ids only' half also holds._


**Expected:** filters [{hasNoProperty:["power"]},{enabled:[true]},{isPlugin:[false]}] returns enabled non-plugin devices lacking a power property (around 140 actuators exist in this state).


**Actual:** Returned [] (empty array, no error). Also: with no attributes list, filter_devices returned only {id} per device, not full records as the description says ("Omit to get all"). Passing attributes ["id","name","roomID","parentId","type","properties"] returned full records.


**Reproduction:**

Not fully isolated. Ran hasNoProperty+enabled+isPlugin together; did not test hasNoProperty alone. Workaround: enabled+isPlugin filter, then subtract the hasProperty power id set locally. Omitted-attributes case: same hasProperty power filter, attributes omitted gives ids only; adding attributes incl. "properties" gives full objects.


**Cost:** Silent empty result could be read as "no unmetered actuators". Workaround cost one extra call. Suggest documenting hasNoProperty behaviour and that omitting attributes returns ids only.


### `create_backup` — 51d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). POST /api/service/backups answers 400 'unsupported action'. Not probed: a working call reboots the gateway. Needs the web UI's real request body captured before changing the tool._


**Expected:** Local backup created on HC3 (firmware 5.210.12), gateway reboots to take it.


**Actual:** HTTP 400: Bad Request (POST /api/service/backups) - {"message":"unsupported action "}


**Reproduction:**

Called create_backup {name: "Pre 5.220.11 upgrade - 5.210.12", type: "local"} immediately after can_create_backup returned canCreateLocalBackup: true, canCreateCloudBackup: true. Single attempt, not isolated. The trailing space in "unsupported action " suggests the request body carries an empty or missing action field; not tested with type "remote" or with an explicit action value.


**Cost:** Blocked the pre-upgrade backup before firmware update 5.220.11; fallback is the backup option in the web UI update dialog. Suggested fix: check the body sent to POST /api/service/backups (HC3 likely expects an action such as "create" plus description/type).


_Reported by Claude chat session, 2026-09-23_


### `manage_plugin_interfaces` — 74d ago


**Verdict:** confirmed, fixed 4.30.0


_The second device type and fifth recorded failure, which is what made the pattern worth settling._


**Expected:** Interfaces removed from the QuickApp device, removing the Auto off card and Favourite position button from its sheet.


**Actual:** HTTP 403 Forbidden for both calls: delete ["autoTurnOff","favoritePosition","light"] and delete ["light"] alone, on QA 5001 (com.fibaro.multilevelSwitch, freshly created, firmware 5.210.12).


**Reproduction:**

Single variable: same deviceId, same action=delete, interfaces list varied from three entries to one ("light" only) - both 403, so the refusal is not about a specific interface. Not yet isolated whether a non-quickApp device would accept the same delete.


**Cost:** None lasting: useEmbededView=false suppresses the interface-driven UI furniture instead, and setting deviceRole "Other" via modify_device drops the light interface + isLight (observed on QA 4998). Tool description could point at those two routes.


_Reported by Claude session 2026-08-31 towels QAs_


### `update_device_property` — 89d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). A non-numeric value on a multilevelSensor is silently declined: no error, null result, modified unchanged; self:updateProperty does not throw either. Belongs in api notes silent_writes._


**Expected:** A non-numeric placeholder in `value` on a com.fibaro.multilevelSensor QuickApp, to render a dash on the tile instead of a misleading zero when the automation has nothing to report. Failing that, an error.


**Actual:** Both writes were silently declined. update_device_property returned null (as it does on success too), no error appeared in the HC3 log, and a read-back showed value unchanged at 2 with its original `modified` timestamp. The same is true from inside the QuickApp: self:updateProperty("value", "-") does not throw, so a pcall around it reports success, and the only way to detect the failure is to read the property back and compare `modified`. Writing a number to the same property in the same tick works normally. The sibling `unit` property accepts arbitrary strings, so the rejection is specific to `value` on this type.


**Reproduction:**

Device 4984, com.fibaro.multilevelSensor QuickApp, firmware 5.210.12, value currently 2. Failing: update_device_property(4984, "value", "-") then again with "". Read-back unchanged, `modified` unchanged. Working, one variable changed, same device and same tool: update_device_property(4984, "value", 0) updates and bumps `modified`. Only the type of the submitted value differs. Also isolated against the property: update_device_property(4984, "unit", "IDLE") with a string succeeds on the same device in the same session, so it is `value` that is type-checked, not the write path.


**Cost:** A silent no-op that a pcall cannot catch and that the tool result cannot distinguish from success. I reported the change as working on the strength of the unit property having updated, and only caught it because I read value back separately and noticed a stale `modified`. Practical consequence: a multilevelSensor tile cannot show a blank or dashed figure, so "no data" has to be encoded some other way (the unit word, or the log line). Worth stating in update_device_property's description that a t


_Reported by Claude, via the owner's Shading QuickApp session, 2026-08-16_


### `general` — 89d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). A QuickApp writing its OWN variables through the device API restarts itself, in a loop if done in onInit. Scope: self:setVariable does NOT restart (Shading writes state every tick; firmwareWatch relies on it), so the copier must have written via api.put on its own device. Guide gap: state the distinction._


**Expected:** set_quickapp_variable's description states that writing a QuickApp variable from OUTSIDE restarts the QuickApp. I read that as external writes only, and expected self:setVariable from inside to be the safe path, since that is how a QuickApp normally persists its own state.


**Actual:** The installer never got past its first step. The log shows "installer: copying from Shading (4953)", then the seven variables copied, then immediately "installer: copying from Shading (4953)" again, repeating several times a second. Writing its own quickAppVariables restarts the QuickApp, onInit begins again, copies the same seven, restarts again. The file-copy step that came after was never reached. The loop was stopped by disabling the device. Moving the identical logic into a second, throwaway QuickApp (4983) and having it write into 4984 worked first time: seven variables in one PUT, then seven files, then main last, 145 KB total, all byte-identical, no restart loop, nothing retyped through the conversation.


**Reproduction:**

Firmware 5.210.12. Failing: QuickApp 4984's own main.lua calls self:setVariable(name, value) for seven variables inside onInit. Restart loop, file step never reached. Working, one variable changed, same seven variables and same source device: the identical loop run from a DIFFERENT QuickApp (4983) writing into 4984 via api.put("/devices/4984", {properties={quickAppVariables=vars}}). Completes, no loop. The variable is which device executes the write, not what is written. I have not isolated whether a single self:setVariable call restarts, or only the first of several, since seven were written before the restart was observed.


**Cost:** A live QuickApp in a restart loop until it was disabled. More usefully: this makes self-rebuild structurally impossible, which is worth documenting positively, because copying a QuickApp gateway-side is otherwise an excellent technique. Reproducing an eight-file QuickApp by pasting content through a conversation costs tens of thousands of tokens and every byte is a chance to mistype; driving api.get/api.put from a second QuickApp moves it verbatim in about a second. The rule to record is: the co


_Reported by Claude, via the owner's Shading QuickApp migration session, 2026-08-16_


### `modify_device` — 89d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). HC3 refuses a `type` change with a bare 404 on an existing device. Tool fix tracked under the modify_device 404 failure row._


**Expected:** modify_device topLevel accepts device body root fields, and `type` is one. I expected either a successful change or a refusal that named the reason.


**Actual:** HTTP 404: Not Found. The same tool against the same device with topLevel={"visible": true} returned verified: true, so the device and the write path are both fine and HC3 is refusing the type change specifically. Separately, GET /devices/4953/properties/value on a com.fibaro.genericDevice also returns HTTP 404 rather than a null value, because that type carries no value property at all; the same read on a com.fibaro.multilevelSensor returns {value: 0}.


**Reproduction:**

Firmware 5.210.12, device 4953, a live com.fibaro.genericDevice QuickApp. Failing: modify_device(deviceId=4953, topLevel={"type": "com.fibaro.multilevelSensor"}) returns HTTP 404. Working, single variable changed, same tool and same device: modify_device(deviceId=4953, topLevel={"visible": true}) returns verified: true. Only the field submitted differs.


**Cost:** Two costs. First, a bare 404 reads as "wrong device id" and sent me checking the id before I thought to test the endpoint with a harmless field. Second, and larger: because the type cannot be changed in place, giving an existing QuickApp a tile value column requires rebuilding it as a new device with a new id, which is a substantially bigger piece of work than the user was expecting when he asked for it. Worth stating in the tool description as "HC3 refuses type changes on an existing device; re


_Reported by Claude, via the owner's Shading QuickApp migration session, 2026-08-16_


### `general` — 89d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). api.post('/plugins/updateView', {componentName, propertyName='options', newValue}) replaces select options live with no restart and nothing else disturbed. Guide gap._


**Expected:** Based on the ui guide's warnings about selects destroying the whole tile, and on the assumption that runtime option updates were the fragile path, I expected either an empty view or a restart loop. I had advised the user it was too risky to attempt.


**Actual:** It works, and cleanly. api.post("/plugins/updateView", {deviceId=..., componentName="devicePicker", propertyName="options", newValue=<array of option tables>}) replaced the option labels. Read-back via get_plugin_view confirmed: selectionType "single" survived, the select's eventBinding survived, every other component survived, the option value fields were untouched so a selection still dispatches the same id, and the QuickApp did NOT restart (the header label still showed the previous tick's timestamp). It is now called once per five-minute refresh in a live QuickApp and has been stable across many cycles. The endpoint returns nothing at all, so the read-back is the only evidence either way.


**Reproduction:**

QuickApp 4953, firmware 5.210.12, com.fibaro.genericDevice, view containing a select named devicePicker with eleven options and selectionType "single". Single variable: change only the text field of one option, keeping value, type, selectionType and every other component identical, and submit the full options array through api.post("/plugins/updateView", propertyName="options"). Before: option reads "Guest Awning". After: "Guest Awning (open)". get_plugin_view read immediately afterwards shows the whole layout intact with the new label. Repeated later with all eleven labels changed, same result.


**Cost:** A wrong negative I gave the user directly: I told him picker labels could not safely carry live state and offered a worse alternative (a long text label listing every device). He pushed back and asked to try it anyway. It worked first time. Had he accepted my answer, the capability would have been recorded as impossible on my say-so, which is the exact failure mode the report_finding description warns about. Note also: self:updateView(element, "options", array) is NOT the working path, since upd


_Reported by Claude, via the owner's Shading QuickApp migration session, 2026-08-16_


### `modify_device` — 89d ago


**Verdict:** untested


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). viewLayout + uiCallbacks in one write left every eventBinding null on 5.210.12. NOT reproduced as such on 5.220.15: Shading's layout there carries no eventBinding blocks at all, and the 13 Nov tile-restore test (viewLayout + uiView + uiCallbacks in one write) rendered and stored identically. Different format, so neither confirms nor refutes._


**Expected:** Submitting viewLayout and uiCallbacks together in one modify_device call would produce a working tile, since both writes verify individually.


**Actual:** Every element's eventBinding in the stored view came back null: the picker showed "eventBinding": {"onToggled": null} and each button "eventBinding": {"onReleased": null, "onLongPressDown": null, "onLongPressReleased": null}. The tile rendered correctly and modify_device reported verified: true. No tap reached the QuickApp. Writing the same uiCallbacks array again on its own did NOT repair the bindings; they stayed null. Writing the viewLayout again on its own, with the correct uiCallbacks already stored, did repair them, and a subsequent call_ui_event dispatched to the named callback and ran.


**Reproduction:**

On QuickApp 4984 (com.fibaro.multilevelSensor, firmware 5.210.12). Working case: modify_device with properties={viewLayout} alone, then a second modify_device with properties={uiCallbacks} alone. Bindings present, taps dispatch. Failing case: identical layout and identical callbacks array submitted in ONE modify_device call with both keys under properties. Bindings null. The single variable is whether the two properties are submitted together or as two separate calls. Repair, also isolated: with the correct uiCallbacks already stored, a modify_device of viewLayout alone restores the bindings, while a modify_device of uiCallbacks alone does not. That suggests HC3 generates eventBinding at layout-write time from whatever uiCallbacks are stored at that moment, so the correct order is callbacks first, layout second, as two writes.


**Cost:** A live QuickApp panel was silently deaf for about ten minutes: all four buttons and the device picker rendered and did nothing, with no error in the log or in the tool response. Found only because the user's screenshot prompted a get_plugin_view read. The tool description tells you to read the view back after a layout write to confirm the components are present, which they were; it does not tell you to check eventBinding, and components-present is not sufficient.


_Reported by Claude, via the owner's Shading QuickApp migration session, 2026-08-16_


### `get_icon` — 90d ago


**Verdict:** confirmed, fixed 4.21.2


_The wrong-negative in get_icon's own error text. See the failures entry for the same defect._


**Expected:** Either get_icon fetches a user-uploaded device icon, or its negative claim is correct. The claim that no /assets path serves them appears to be false.


**Actual:** get_icon fails and reports: "user-uploaded *device* icons are not served under any known /assets path on 5.210.12 - they are addressable by numeric id via a device's deviceIcon property, but not fetchable as a file." It had tried /assets/userIcons/User1075/User1075.svg and /assets/userIcons/User1075/User10750.svg, both unrouted. But a live device on this gateway, Irrigation QA 4933, carries properties.icon = {path: "/assets/userIcons/devices/User1072/User1072.svg", source: "HC"} and renders that icon correctly in the iOS app. The tool's candidate paths omit the "devices/" segment.


**Reproduction:**

Path claim, single variable is the path: get_icon({category:"device", name:"User1075", extension:"svg", userIcon:true}) fails against /assets/userIcons/User1075/...; the same icon family on device 4933 is stored at /assets/userIcons/devices/User1072/User1072.svg. I have NOT directly fetched the devices/ path (get_icon builds its own candidates and gives no way to pass one), so the evidence is 4933's stored path plus the app rendering it, not a successful fetch. Attach claim, single variable is whether properties.icon is written: 1) create_quickapp type com.fibaro.genericDevice -> device 4953 with icon {}. 2) upload_icon device/genericDevice/svg -> User1075, id 1075. 3) modify_device({deviceId:4953, properties:{deviceIcon:1075}}) -> verified true, and properties.icon remains {}; tile renders blank. Compare device 4933, same type, which has deviceIcon 1053 AND icon.path set, and renders.


**Cost:** Two costs. First, the stated impossibility is a wrong negative of exactly the kind the finding guidance warns about, and it is baked into the tool's own error text where it will steer future sessions away from something that works. Second, and separately, upload_icon's hint says to attach an icon with modify_device({deviceId, properties:{deviceIcon: id}}). On a freshly created genericDevice QuickApp that is not sufficient: deviceIcon was set and verified on 4953, properties.icon stayed {} , and 


_Reported by Claude, Shading QA migration, attaching the Awning icon to QA 4953_


### `manage_plugin_interfaces` — 90d ago


**Verdict:** confirmed, fixed 4.30.0


_The three-variant isolation in this report was correct. The missing device-class arm was run on 3385 on 1 Sep and agreed._


**Expected:** Narrowing to a single interface, or switching action from delete to add, changes the outcome, telling us whether the refusal is per-interface or blanket.


**Actual:** All three variants return the same bare "HTTP 403: Forbidden" with no body: delete ["autoTurnOff","light"], delete ["light"] alone, and add ["energy"]. Device unchanged in every case (interfaces still ["autoTurnOff","light","quickApp"]). Identical refusal for add and delete points at the endpoint or its credentials rather than at interface-specific validation.


**Reproduction:**

Single variable varied across three calls on the same device 4952 immediately after creation, nothing else changed between them: (a) action="delete" interfaces=["autoTurnOff","light"] -> 403; (b) action="delete" interfaces=["light"] -> 403; (c) action="add" interfaces=["energy"] -> 403. Not yet isolated: whether a NON-QuickApp device also returns 403, which would separate "endpoint unavailable" from "QuickApps rejected". I have not tried that because the only candidates are live Z-Wave devices.


**Cost:** Refines the earlier finding on this tool: the refusal is not about which interface or which direction. If the endpoint is simply not permitted on this firmware or with these credentials, the tool description should say so rather than presenting add/delete as available, because the failure costs a create-and-inspect cycle to discover.


_Reported by Claude, Shading QA migration, follow-up isolation on QA 4952_


### `manage_plugin_interfaces` — 90d ago


**Verdict:** confirmed, fixed 4.30.0


_Settled 1 Sep on device 3385: the refusal is blanket, not per-interface, per-direction or per-device-class. Endpoint catalogued in KNOWN_DEAD_ENDPOINTS.md and the tool now carries it._


**Expected:** manage_plugin_interfaces action="delete" removes the named interfaces from a QuickApp, or refuses with a reason naming which interface cannot be removed.


**Actual:** HTTP 403: Forbidden. No body detail. The device is unchanged: a follow-up get_device_info shows interfaces still ["autoTurnOff","light","quickApp"], so nothing partial was written.


**Reproduction:**

Single variable: the call itself. 1) create_quickapp name="Shading" type="com.fibaro.binarySwitch" roomId=219 with an initialView and initialProperties.quickAppVariables. Succeeds, returns deviceId 4952 with interfaces ["autoTurnOff","light","quickApp"]. 2) manage_plugin_interfaces deviceId=4952 action="delete" interfaces=["autoTurnOff","light"] on that same device, immediately after, nothing else changed. Fails with HTTP 403. I have NOT isolated whether the refusal is per-interface (autoTurnOff vs light), whether "delete" is rejected for all interfaces on all devices, or whether it is specific to QuickApp-type devices or to a device with no files pushed yet. Removing one interface at a time would isolate the first of those.


**Cost:** Cannot remove autoTurnOff from a freshly created binarySwitch QuickApp via MCP. That interface carries autoOffDefaultTime 900, so a QA using its own on/off state as an automation enable risks being turned off by the gateway 15 minutes after every enable. Workaround not yet chosen: either set params via a different path, avoid binarySwitch as the QA type, or accept the interface and never rely on the device value. Also unclear whether the 403 is HC3's or the MCP layer's, which changes the workaro


_Reported by Claude, working on the Shading QA migration (scene 247 to QA 4952)_


### `get_hc3_lua_scenes_guide` — 90d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). An uncaught api.* error kills a scene with no log at all, and run_scene_sync still reports success. QA files are /api/quickApp/{id}/files/{name}, not /devices/{id}/files. Guide gap: say both, and wrap api calls in pcall + log._


**Expected:** Either that a scene dying on an uncaught api.* error leaves something in the log, or that the QuickApp file endpoint is stated in the guides where someone writing a gateway-side file patcher would find it. get_quickapp_file's own description gives the correct path, but a session driving REST directly from a scene does not necessarily read that tool's description first.


**Actual:** A Lua scene calling api.get("/devices/4933/files/watering") produced NO output whatsoever — not the first log line, not an error, nothing in the debug log. run_scene_sync reported success in 19ms. The scene had run and died on its first API call, before reaching any logging.

The correct endpoint is /api/quickApp/{id}/files/{name}. A bare api.get on the wrong path throws, and an uncaught throw in a scene terminates it with no trace anywhere. The failure is indistinguishable from a scene that never executed, or one whose content failed to compile.


**Reproduction:**

Single variable. Create a Lua scene whose first statement is an unwrapped api.get, then run_scene_sync and read the debug log.

  A. api.get("/devices/4933/files/watering")            — scene produces no log output at all.
  B. api.get("/quickApp/4933/files/watering")           — returns the file, scene proceeds normally.

Only the path differs. Adding a fibaro.debug before the call, and pcall around it, makes A visible as a caught error rather than silence.


**Cost:** One wasted scene run and several minutes lost to the wrong hypothesis — silence pointed at a compile failure or a scene-execution problem rather than at a bad path. The fix is a pattern worth stating in the guide: in a probe scene, log BEFORE the first API call and wrap every api.* in pcall, otherwise a bad path is invisible.


_Reported by Claude, working with the owner on QA 4933 (Irrigation), 15 Aug 2026_


### `patch_quickapp_file` — 90d ago


**Verdict:** confirmed


_Client-side, no server fix available: a tool going unreachable mid-session is the documented stale-schema symptom — schemas cache at connect and a reconnect may not refresh them. Recorded rather than fixed._


**Expected:** Either that a tool used earlier in a session stays reachable, or that tool_search can reliably load it back when queried with its own description text. A tool that works and then cannot be found again by any phrasing is indistinguishable from the tool having been withdrawn.


**Actual:** patch_quickapp_file was present and callable at the start of this session — I used it successfully three times against QA 4933 (icons.lua and main.lua), each returning a diff and a verified write. Later in the same session it became unreachable. Calling it directly returned:

  Tool 'hc3:patch_quickapp_file' not found.

and five subsequent tool_search calls failed to load it back, including searches using phrases lifted verbatim from its own description ("patch_quickapp_file edit", "apply edits old new dryRun expectedHash quickapp", "each old must match exactly count times or nothing is written", "edit part of a file supplying only the text to replace", and a bare "patch", which returned "No matching tools found"). Other HC3 MCP tools continued to load normally from tool_search throughout, so the server and tunnel were up.


**Reproduction:**

NOT ISOLATED — I cannot state the trigger, and the honest summary is that I do not know what changed between the working calls and the failing ones.

What I can state: patch_quickapp_file succeeded at three points early in a long session, then after an interval of other HC3 MCP calls (get_icon, upload_icon, update_quickapp_file, get_debug_messages) it was not found, and repeated tool_search calls with its exact description text did not return it. No error, no reconnection, no server restart that I am aware of, and other tools kept loading.

Candidate variables I did not separate: elapsed session length; the number of distinct HC3 MCP tools loaded in between; whether an intervening update_quickapp_file call displaced it; and whether the search index ranks it below other results for every phrasing I tried.

To test: call patch_quickapp_file, then load a dozen unrelated HC3 MCP tools via tool_search, then attempt patch_quickapp_file again — varying only the count of tools loaded in between.


**Cost:** Two edits to a 55KB engine file (watering.lua) and a 20KB main.lua had to go through a hand-written gateway-side patch scene instead: create a temp Lua scene, fetch the file over the REST API, assert the anchor matches exactly once, replace, PUT, re-read and byte-compare, then delete the scene. That worked and was verified byte-identical each time, but it is three round trips and a live scene created on a production gateway to do what one tool call does. It also cost a silent failed run when the


_Reported by Claude, working with the owner on QA 4933 (Irrigation), 15 Aug 2026_


### `upload_icon` — 90d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Path form works and is now in the QuickApp guide (properties.icon {path='/assets/userIcons/devices/User<N>/...', source='HC'}); get_icon's paths fixed in 4.21.2._


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


_Reported by Claude, working with the owner on QA 4933 (Irrigation), 15 Aug 2026_


### `get_hc3_quickapp_programming_guide` — 90d ago


**Verdict:** confirmed


_Settled 15 Aug by scripts/probe-uicallbacks.mjs. A real tap ALWAYS dispatches to UIAction positionally, whatever uiCallbacks registers; only call_ui_event honours the registered name and passes an event table. This report was right and this file's own model was wrong. Consequences applied to call_ui_event and modify_device descriptions._


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


_Reported by Claude, working with the owner on QA 4933 (Irrigation), 15 Aug 2026_


### `get_ios_devices` — 92d ago


**Verdict:** confirmed


_Settled 1 Sep by scripts/probe-ios-device-by-id.mjs. GET /api/iosDevices/951 returned all 14 registered devices, byte-identical to the bare list (1284 bytes both ways) — the id segment is ignored. Worse than a 404 because it looks like it worked: anything taking the first element gets device 937 whatever it asked for. The DELETE shape the report also names was NOT probed; it would deregister a real phone._


**Expected:** A per-id GET on a collection route returns that one record, or 404. Anything built on it would otherwise appear to work.


**Actual:** GET /iosDevices/937 returned 200 with the entire 15-entry collection, identical to GET /iosDevices, rather than the single record for 937 or a 404. The path segment is ignored. Related, and useful for a cleanup tool: DELETE /iosDevices/{id} returns 400 {"reason":"MISSING_PARAMETER","message":"udid: missing required parameter"}; the same with the udid in a body, or with the udid as the path segment, gives the identical 400; only DELETE /iosDevices/{id}?udid={udid} gets past validation, returning 404 for an id/udid pair that does not exist.


**Reproduction:**

Vary only the path: api.get("/iosDevices") and api.get("/iosDevices/937") from the same Lua scene run return byte-identical 200 bodies. The DELETE shapes were varied one at a time in a second run, holding the fake udid 00000000-0000-0000-0000-000000000000 constant across all four; collection count stayed at 15 throughout, so nothing was deleted and the 404 on the query-string form is the parameter being accepted rather than a side effect.


**Cost:** Two things for the server. A per-id read of an iOS registration silently returns the whole list, so any code filtering client-side will look correct and any code taking the first element will be wrong. And stale registration cleanup is scriptable after all via DELETE /iosDevices/{id}?udid={udid}, which is worth a tool, given the record carries no last-seen or token-status field to identify staleness from and push is true on all fifteen.


_Reported by Claude, working with the owner, 5.210.12_


### `general` — 92d ago


**Verdict:** confirmed


_Triaged 13 Nov 2026 against the Pi's log (/var/lib/hc3-mcp/friction.jsonl). Reporter tested every arm. /mobile/push VALIDATES (400 wrong id kind or category, 404 unknown id, 500 missing category or empty list); fibaro.alert returns nil and reports nothing. Corrects the 'both fail silently' assumption. Guide gap: the routing section covers id kinds, not this._


**Expected:** Both push mechanisms would report a wrong id kind the same way, so a tool wrapping either could verify its own call.


**Actual:** POST /mobile/push validates and reports. Correct iOS device id 4217 with category YES_NO: 200 with {id:258, created, devices:[4217], action:{...}}. User id 2 in mobileDevices: 400 {"reason":"deviceId","message":"wrong device type for push notification"}. Nonexistent id 999999: 404. category omitted: 500. category "STANDARD": 400 {"reason":"category","message":"wrong category for push notification"}. Empty mobileDevices list: 500. fibaro.alert reports nothing. Returned nil for all four of: ("push",{2},msg) with a real user id, ("push",{4217},msg) with a device id in the user slot, ("push",{999999},msg), and ("simplePush",{2},msg). /notificationCenter stayed at 4 entries with its newest dated 1786357761, so no trace is left there. The push record POST creates cannot be read back either: GET /mobile/push, GET /mobile/push/258 and GET /mobile/pushes all return 405.


**Reproduction:**

Single variable in each pair. For /mobile/push, hold body and category constant and vary only mobileDevices between {4217} and {2}: 200 versus 400. For fibaro.alert, hold type and message constant and vary only the id list between {2} and {4217}: nil versus nil, indistinguishable. Both pairs run from one Lua scene in a single execution.


**Cost:** Corrects an assumption we had been carrying that both fail silently on the wrong id kind. Only fibaro.alert does. A tool wrapping /mobile/push can assert status 200 and that the echoed devices array matches the request; a tool wrapping fibaro.alert has no verification channel at all and should say so rather than report success. Separate caveat worth documenting: 200 from /mobile/push means accepted, not delivered. A push to registration 937, which receives nothing in practice, returned a clean 2


_Reported by Claude, working with the owner, 5.210.12_


### `general` — 92d ago


**Verdict:** confirmed


_Settled 1 Sep by scripts/probe-scene-variables.mjs on scene 670. All four REST spellings return 501 with an empty body — and so does a deliberately nonsensical sub-path on the same scene, which is the control that makes the result mean something: this is an unrouted path, not a feature that exists and refuses. The scene-variable tool is UNBUILDABLE, not unbuilt; the gap is struck rather than carried. Says nothing about fibaro.setSceneVariable, which never goes through REST._


**Expected:** Some REST path reaches scene variables, so the MCP could offer a get/set tool for them the way it does for globalVariables and quickAppVariables.


**Actual:** Every REST path tried returns 501 with an empty string body: GET /scenes/788/variables, GET /scenes/788/variables/probeVar, GET /scenes/788/variable/probeVar, POST /scenes/788/variables {name,value}. GET /scenes/788 returns 200 with 21 keys and none of them holds variables: categories, content, created, description, enabled, hidden, icon, iconExtension, id, isRunning, maxRunningInstances, mode, name, protectedByPin, restart, roomId, sortOrder, started, stopOnAlarm, type, updated. Inside the same scene run, fibaro.setSceneVariable("probeVar", "probe-1786648475") followed by fibaro.getSceneVariable returned "probe-1786648475" correctly.


**Reproduction:**

Single variable is the path. From a Lua scene, api.get("/scenes/788/variables") returns 501 while api.get("/scenes/788") returns 200 against the same gateway in the same run. Control established in the same run: three paths known not to exist (/scenes/788/thisPathDoesNotExist, /completeNonsenseEndpoint GET and POST) also return 501 empty, and two known-good paths (/users/2, /notificationCenter) return 200 with bodies. So 501-empty is this gateway's no-such-route response and the variable paths are genuinely absent, not misnamed.


**Cost:** Prevents a wrong assumption in tool design. Scene variables are Lua-only on this firmware, so an agent cannot read or write scene state at all. Worth documenting as unreachable, with the recommendation that scene state an agent needs to see must live in a global variable or a QuickApp variable instead.


_Reported by Claude, working with the owner, 5.210.12_


### `create_scene` — 92d ago


**Verdict:** confirmed, fixed 4.29.0


_`content` documented as optional; omitting it drew a Lua-engine 400 about a nil `conditions`. create_scene now supplies an empty body that subscribes to nothing and reports contentDefaulted._


**Expected:** create_scene documents `content` as optional ("Scene body. String or object"), so omitting it should create an empty scene ready to be populated by update_scene_content.


**Actual:** HTTP 400: {"type":"ERROR","reason":"SceneValidationError","message":"SceneError: /opt/fibaro/lua_engine/lua/engine.lua:623: attempt to concatenate a nil value (field 'conditions')\nstack traceback:\n\t/opt/fibaro/lua_engine/lua/engine.lua:623: in function 'engine.subscribe'\n\t/opt/fibaro/lua_engine/lua/engineMain.lua:27: in function 'engineSubscribe'."} Retrying with content = {"actions":"fibaro.debug(\"PROBE\",\"placeholder\")","conditions":"{ conditions = {}, operator = \"any\" }"} and nothing else changed succeeded, returning sceneId 788.


**Reproduction:**

Isolated to one variable. Call create_scene twice with identical name/roomId/type ("lua"), varying only `content`: omitted fails with the 400 above; supplying {actions, conditions} where conditions is a Lua table string succeeds. Both attempts made within the same minute against the same gateway.


**Cost:** One failed create before the shape was guessed. Low cost here, but the error surfaces from the Lua engine rather than the validation layer, so it reads like a server fault rather than a missing parameter. Suggest making content required, or defaulting conditions to a valid empty table when content is omitted.


_Reported by Claude, working with the owner, 5.210.12_


### `general` — 94d ago


**Verdict:** by-design


_Not a finding: the `statedir-check` self-test, filed to prove the finding channel survives a restart. Kept so nobody re-investigates it as a defect._


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
| **untested** | Qubino Mini Dimmer / FGD212 / ZEN54 keep their configuration parameters (min 60/61, 1/2, 4/5) through a power cut | Z-Wave devices normally store parameters in non-volatile memory, but the owner suspects these get wiped. Test after the next cut: `restore_dimmer_settings` dry run against the register; any change it plans is the answer. |

#### Resolved

| Verdict | Claim | Resolution |
|---|---|---|
| **superseded 15 Aug** | Named `uiCallbacks` dispatch as `method(self, event)` with `{eventType, elementName, values, deviceId}` | Recorded 13 Aug as resolved: writing the named array back with `modify_device` sticks, survives a later `update_multiple_quickapp_files` push, and dispatches the named method. **The sticking is confirmed and the dispatch claim is not.** It was established with `call_ui_event`, which dispatches to the registered name; a real tap always calls `UIAction` positionally. See "The uiCallbacks conflict" below — this row is the one that put a tool-only result into `modify_device`'s description as an end-to-end guarantee. Kept rather than rewritten, because the failure was in the method, not the observation. |
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
- ~~No scene-variable tool, despite "scene variables beat globals" being sound.~~
  **UNBUILDABLE — settled 1 Sep 2026, gap struck.** `scripts/probe-scene-variables.mjs`
  on scene 670: all four REST spellings return 501 with an empty body, and so
  does a deliberately nonsensical sub-path on the same scene. That control is
  what makes it evidence — the arms match an unrouted path, not a feature that
  exists and refuses. The claim was attributed to jgab (forum topic 79129) and
  had gone untested for nineteen days while the gap sat on a list as though
  someone would get to it. Struck rather than deleted, so it is not proposed
  again. `fibaro.setSceneVariable` still works inside a running scene; it never
  goes through REST, and both facts are true at once.
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
| ~~`manage_plugin_interfaces` returns a bare `HTTP 403` for add *and* delete, single and multi, device unchanged~~ | **Settled 1 Sep 2026 — see below.** Confirmed, the missing device-class arm was run on 3385, and the endpoint is catalogued in KNOWN_DEAD_ENDPOINTS.md. Carried by the tool in 4.30.0. |
| ~~`create_scene` documents `content` as optional; omitting it throws a Lua-engine 400 about concatenating a nil `conditions`~~ | **Confirmed and fixed in 4.29.0, 1 Sep 2026** — see the row below. Struck rather than deleted: a stale awaiting-verdict row is the same failure as a stale open-gap row. |
| ~~Scene variables have **no REST API**~~ | **CONFIRMED 1 Sep 2026** by `scripts/probe-scene-variables.mjs` on scene 670. Four spellings, all 501-empty; known-good control 200, nonsense control 501-empty and identical to the arms. The gap in "Gaps" below is struck: the tool is unbuildable, not unbuilt. |
| `upload_icon`'s attach hint (`modify_device({properties:{deviceIcon: id}})`) leaves a QuickApp tile **blank**; what renders is `properties.icon = {path, source="HC"}` written from inside the owning QA | A/B on Shading versus Irrigation. Corroborated independently by the `modify_device` post-write verification failure on **Outdoor Mean** in the table above, where `properties.icon` was submitted and did not read back — this server's own guard catching the silent discard. |
| ~~`GET /iosDevices/{id}` returns the **entire** collection, not one record~~ | **CONFIRMED 1 Sep 2026** by `scripts/probe-ios-device-by-id.mjs`: asking for id 951 returned all 14 registered devices, byte-identical to the bare list at 1284 bytes. The id segment is ignored. Deliberately asked for the SECOND device, not the first, so "honoured" and "ignored" could not look alike. The `DELETE /iosDevices/{id}?udid={udid}` half is still untested and stays that way here — it would deregister a real phone. |
| Named `uiCallbacks` dispatched to `UIAction` **positionally**, not to the registered callback, for a `select` with `selectionType "multi"` | **Conflicts with the "Resolved 13 Aug" row above**, whose scratch QA has since been deleted. Sharper than it looks: Irrigation's own source records `UIAction` receiving a single event **table** on 7 Aug and three **positional** args on 15 Aug, same device, same firmware. See the reconciling model below. Do not adopt either way yet. |

#### The uiCallbacks conflict, and a model that fits every observation

Four observations, none of which has to be wrong:

| When | Subject | Registered callback | What HC3 called, and how |
|---|---|---|---|
| 7 Aug | Irrigation, a button | `UIAction` | `UIAction`, one **table** argument (recorded in that QA's own source) |
| 13 Aug | a scratch QA, since deleted | a **name** | the **named method**, event table (the "Resolved" row above) |
| 15 Aug | Irrigation, `selSeedZones`, a multi `select` | a **name** | `UIAction`, three **positional** args |
| now | Irrigation, live `uiCallbacks` | five buttons on `UIAction`, the select on `seedlingZonesChanged` | — |

**SETTLED 15 Aug 2026 by `scripts/probe-uicallbacks.mjs`.** A model was proposed
here first — names honoured for buttons but not selects, argument shape
following the dispatch path — and the probe **refuted it**. It is left in the
history rather than quietly replaced, because it was wrong in the specific way
worth remembering: it explained every observation available at the time. All of
them had come through one channel.

The axis is not the element, it is **who fired the event**:

| | `call_ui_event` | a real tap in the app |
|---|---|---|
| handler called | the name registered in `uiCallbacks` | **always `UIAction`**, whatever is registered |
| arguments | ONE table `{eventType, elementName, values, deviceId}` | **positional**: `(eventType, elementName)` for a button, `(eventType, elementName, values)` for a select |
| trace emitted | `UIEvent:` | `onAction:` |

Twelve cells through the tool, every one a table dispatched to the registered
name, buttons and selects alike. Eighteen taps, every one positional to
`UIAction`, buttons and selects alike, including on the QA whose callbacks were
still HC3's generated `ui<Element>On<Event>` names. Both directions clean, no
mixed cells.

So **the 15 Aug field report was right and this file's own model was wrong**.
Irrigation's source comment saying the name "is NOT honoured" is correct for the
only path its users take.

Consequences, all now applied:

- **`call_ui_event`'s description understated this to the point of being a
  trap.** It is recommended in its own text as a verification step, and it is
  more generous than reality on *both* axes: it will show a named callback
  working when no tap will reach it, and hand a table where a tap hands strings.
- **`modify_device`'s description asserted the named method "is dispatched"**,
  which was only ever true through the tool. That is how a claim verified on 13
  Aug through `call_ui_event` became a shipped end-to-end guarantee.
- **A restart is NOT required** for a written-back binding to take effect,
  which settles the variable the reporter could not isolate: their write was
  sufficient and the restart incidental. Recorded on `modify_device`.
- **`create_quickapp` normalises the eventType as well as the callback**: a
  select registered `onToggled` comes back `onReleased`. Only the callback half
  was documented.

The general lesson is worth more than the specific fact. Every record that
disagreed with the field report had been produced with `call_ui_event`, so they
agreed with each other and with nothing a user does. **A tool that simulates an
event is evidence about the tool until something outside it agrees.**

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

**Confirmed and fixed in 4.28.0 — 1 Sep 2026.** The next batch did arrive, and
the count had roughly doubled: **11 of the 20 findings carrying an `impact` sat
exactly on the 500 cap**, and 3 `actual` fields on the 1000. `reproduction` at
4000 had never once been hit, which is what set the new numbers rather than a
guess: `impact` and `actual` to 4000, `expected` to 2000, `reproduction`
unchanged.

Raising the caps was the smaller half. Truncation is now marked in the stored
text and returned to the reporter by `report_finding` in the same turn, and the
limits are stated in the input schema where a caller can act on them before the
call. Several of the eleven read as complete sentences that simply end early,
which is the same silent-success shape this server exists to close: a cap the
reporter cannot see is indistinguishable from a report that finished.

One consequence worth recording, because it was not in the original row.
Bigger findings on a size-capped log get evicted sooner, and a finding is the
entry that cannot be recovered — a failure recurs the next time anyone hits it,
a written reproduction does not. Rotation now drops eligible failures first.

Nothing recovers the text already lost from the 11 rows above. They are
re-testable from their reproductions, which survived.

#### The two 404 rows at the top of the table — settled 1 Sep 2026

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | The `get_device_property` and `get_device_parameters` rows are a server defect, not user error. They are **51 of the 83 recorded failures**, and the message is the bare string `HTTP 404: Not Found` | HC3 sends an empty body on 404, so `HC3Client.request` had nothing to append, and `recordFailure` stores only the tool and the message. The largest cluster in this file named neither the device nor the property. 19 of the 22 `get_device_parameters` entries land within 5s of one of the 29 `get_device_property` entries: one caller, property-then-parameters, same id, 15--31 Aug. **Fixed in 4.27.0**: `HC3HttpError` carries the status as a field and renders the method and path in the message. `get_device_property` re-reads the device on 404 to say which of the two is missing, and lists the properties that do exist; `get_device_parameters` reports an unknown id as an unknown id, its opening device read being its only unguarded request. |
| **confirmed** | Every caller that recognised "gone" by testing the message with `/404|not.?found/i` was already wrong, and putting the path in the message would have made it worse | An id containing `404` matches through the id. Worse, each of the seven post-delete verifies raised its own `still exists` sentinel INSIDE the try whose catch ran that test, so `delete_scene: post-delete verify failed -- scene 4046 still exists` was swallowed and the tool returned success on a scene that was still there. Found by reading, not by telemetry: a silent-success bug cannot report itself. Fixed in 4.27.0 -- sentinel outside the try, `isNotFound(e)` reading the status field. Regression test: `scripts/test/unit-not-found.mjs`, which uses id 4046 deliberately. |

Two things worth keeping. The friction log could not diagnose its own biggest
row, which is a limit of recording the message but not the arguments -- the
message was fixed here, the argument gap was not. And the swallowed-sentinel
bug was adjacent to the fix rather than reported by anyone: it produced a
success result, so no failure was ever recorded for it.

#### `create_scene` without `content` — settled 1 Sep 2026

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | Omitting `content` throws `engine.lua:623: attempt to concatenate a nil value (field 'conditions')`, and `content` reads as optional because it is not in `required` | 4 of the recurring failures, 13 and 15 Aug, plus a finding with a single-variable reproduction. One word from the structured-conditions trap already guarded (nil rather than table), same engine line, naming nothing the caller wrote. |
| **confirmed** | The second-named fix (default the conditions to a valid empty table) is the right one, and the body was already established here | `{ conditions = {}, operator = "all" }` with empty actions is `scripts/probe.mjs`'s `withScene` default -- which creates its throwaway scenes through `create_scene` itself -- and arm 1 of `scripts/probe-scene-conditions.mjs`. Both have run against a live 5.2x gateway repeatedly and been accepted, so no new gateway claim was needed to ship this. **Fixed in 4.29.0**: the body is supplied, `contentDefaulted: true` is returned so the substitution is visible, and the schema states it. |
| **untested** | Whether `type: "scenario"` has the same requirement | Deliberately not defaulted. A scenario body is a different shape and nobody has tested it; a default invented for it would be a guess shipped as a fact. If someone hits the same 400 on a scenario create, that is the reproduction this row is waiting for. |

Worth noting what made this cheap. The fix needed a fact about HC3 -- what the
smallest acceptable scene body is -- and that fact was already sitting in the
probe harness, load-bearing, in daily use. It had never been written down as a
finding because it was never a surprise to anyone. A probe harness accumulates
verified gateway behaviour as a side effect of testing other things, and it is
worth reading before assuming a claim is untested.

#### `manage_plugin_interfaces` — settled 1 Sep 2026

A third finding arrived on 31 Aug (QA 5001, `com.fibaro.multilevelSwitch`),
the second device type and the fifth recorded failure. That settled the
pattern. The cause needed the device-class arm, which the operator unblocked
by nominating device 3385 — and which then took two calls.

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | The refusal is blanket: not per-interface, not per-direction, not per-QuickApp-type | Five failures, three findings, two firmware-5.210.12 QuickApps of different types. `add` and `delete`, a three-entry list and a single entry. Device unchanged in every case, so nothing partial is written. **Recorded in the tool in 4.30.0**, which previously said only "Add or remove interfaces from a device." |
| **confirmed** | The two workarounds were in a finding and nowhere in the code | `useEmbededView: false` suppresses the interface-driven UI furniture; `deviceRole: "Other"` via `modify_device` dropped `light` + `isLight` on QA 4998. Both observed on this gateway, neither isolated as a controlled test, and both now named in the 403 message and the tool description with that caveat attached. |
| **confirmed** | A **non**-QuickApp device is refused too | The variable that had blocked this since 15 August, because the only candidates were live Z-Wave devices in a real house. The operator nominated **3385** (`waterproof SW`, Fibaro FGBS-222, interfaces `["notification","parameters","zwave","zwaveProtection"]`, no `quickApp`), which was usable because it is dead — `deadReason: "power"`. Two arms: `add ["energy"]` → 403, `delete ["energy"]` → 403. `add` was chosen over `delete` because adding is reversible where removing a real interface from a real device is not; the delete arm then named an interface the device does not have, so it could not remove anything even had it worked. **Interfaces and the `modified` timestamp (1779115286) were byte-identical before and after both arms**, so the refusal precedes any state change. Now in KNOWN_DEAD_ENDPOINTS.md. |
| **untested** | Whether it is the firmware or the credentials | Administrator credentials are refused, which makes a permissions ladder an unlikely explanation, but there is only one credential set on this gateway so the two are not formally separated. Only 5.210.12 tried. The tool says this rather than picking one. |

Two things worth keeping.

Four of these five failures were recorded before anyone tried to isolate the
cause, because the tool volunteered nothing and each caller started from zero.
A tool that carries its own known failure mode turns the next report from
rediscovery into either confirmation or news.

And the blocker was never technical. The test took two calls and about a
minute; what it needed was somebody who knew which device was safe to touch.
The finding said so plainly on 15 August — "I have not tried that because the
only candidates are live Z-Wave devices" — and then sat for seventeen days,
through two more failures and a third finding, because that sentence was
filed rather than asked. **When a candidate is blocked on a judgement only the
operator can make, the ledger row should be a question put to them, not a
status.**

#### The generated table said `untested` about everything — settled 1 Sep 2026

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | The generated half of this file, and `hc3://friction`, reported no verdicts at all — the file hard-coded `untested` on every row, the resource showed no verdict column | Known and recorded as a limitation on 13 Aug ("the table hard-codes the verdict `untested`, so a row cannot be marked resolved there"). It then became a defect rather than a gap: rows fixed in 4.19.2 and 4.21.2 were still presented as open candidates two weeks later, and a finding whose own `actual` text opens "RESOLVED IN 4.26.0" sat under a hard-coded untested. After 4.27.0 the two largest rows in the table — 51 of 83 failures — were resolved work being shown as the top candidates for investigation. **Fixed in 4.31.0**: verdicts live in `friction-verdicts.json`, joined on by both surfaces through one shared implementation in `friction.ts`. |
| **confirmed** | A fourth verdict was needed. `untested` is wrong for a guard that is working | `filter_devices requires filters array`, `control_device ... does not declare action`, `patch_quickapp_file ... text was not found` are the tool refusing a call it could see was wrong. Calling those untested candidates spends the same triage pass as calling a fixed bug one. Added `by-design`, documented in the preamble both surfaces render. |
| **confirmed** | A verdict register rots the same way the table did, so it has to be checkable | A verdict asserting a fix, on a row that keeps occurring, is a claim the telemetry contradicts. But a **release date cannot show that**: with deploy lag every entry between release and deploy looks like a failed fix, and the first version of this check duly flagged `upload_icon` (4.19.2) and `create_scene` (4.18.0), both innocent — entries recorded days before the Pi was updated. So entries now carry the server version that wrote them (`v`), and a contradiction requires version evidence: **⚠ SEEN SINCE ON x.y.z** means the failure was recorded BY a build already containing its claimed fix. A date-only discrepancy is reported on the console with the deploy-lag caveat and never written into the committed file. |

Only entries from 4.31.0 onward carry a version, so the two date-only notes
above will keep appearing until those rows age out of the log. That is the
correct behaviour — the alternative is a warning that is probably wrong, which
is how people learn to skim warnings.

The shape of this one is worth keeping. The limitation was recorded honestly,
in the right place, on 13 August. Recording it did not stop it becoming
misinformation, because the record was in the ledger and the falsehood was in
the table, and nobody reads both. **A known limitation in a generated document
decays into a false claim as soon as the underlying facts move.**

#### Source: report_finding, 31 August 2026 — the third batch

Three findings, from the icon session. Triaged here because the previous
source section stops at 15 August and this batch had been sitting untriaged
while its rows were counted in the table above.

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | `manage_plugin_interfaces` refuses a `multilevelSwitch` QuickApp too | The second device type and the fifth recorded failure. Settled in full two sections up; catalogued in KNOWN_DEAD_ENDPOINTS.md. |
| **confirmed** | `get_icon`/`upload_icon` returned no hash, so a re-typed payload could not be checked before it became a wrong tile | Filed for the record by its own author, noting it was already resolved: `sizeBytes` catches truncation and is blind to substitution, and a flipped base64 character is exactly the same length. **Resolved in 4.26.0** — both return md5. Kept because re-testing it against 4.26.0 will correctly refute it, and without the row the reasoning gets re-derived. |
| **confirmed** | No tool composites images, so a badged icon had to leave as base64 and be re-typed back | ~2 hours in one session, almost all transcription, verification and repair. Second occurrence (an Irrigation QA icon, then a towel-rail QA icon), so recurring rather than a one-off. **Fixed in 4.32.0** — `upload_icon` takes an `overlay`, both images resolve gateway-side, nothing passes through the conversation. |

The composite finding is worth reading twice, because it names the mechanism
rather than just the cost: **transcription accuracy depends on DISTANCE from
the tool result.** Copying a payload straight from a fresh result succeeded
twice; copying the same payload from further back in the same conversation
failed three times, twice with damage that single-character repair could not
recover. That generalises well beyond icons — any tool that hands back a blob
the caller must hand forward is on a clock.

It also shows the shape of a good near-miss. 4.26.0 fixed the adjacent case
(`fromIcon`, an icon reused unchanged) and the reporter said plainly that it
did not help when the image must be MODIFIED. The gap was named accurately at
the moment the neighbouring fix shipped, and still took a second occurrence to
close. The single-variable reproduction — same icons, same target, same call,
"whether the image needs modifying" — is what made it actionable a fortnight
later without re-testing anything.

And the honest limit was stated in the finding itself: whether HC3 offers a
server-side image operation that would avoid this was never tested. Still
untested. The fix does the compositing here rather than claiming the gateway
cannot.

#### Two read-only probes — 1 Sep 2026

Both had sat in "Awaiting a verdict" since 13 August. Neither needed a write,
neither took more than a minute, and one of them was quietly holding a roadmap
item open.

| Verdict | Claim | Evidence |
|---|---|---|
| **confirmed** | Scene variables have no REST route at all | Four spellings on scene 670, every one 501 with an empty body. The result rests on the CONTROLS rather than the arms: a known-good path returned 200, and a deliberately nonsensical sub-path on the same scene returned the identical 501-empty. Matching the nonsense path is the signature of no route, which is a different fact from "route exists, not implemented" and leads to a different decision. **The scene-variable tool is unbuildable and its gap is struck.** |
| **confirmed** | `GET /api/iosDevices/{id}` returns the whole collection | 14 devices back for a request naming one, byte-identical to the bare list. The probe asks for the SECOND device deliberately: asking for the first would return something indistinguishable from a correctly-honoured id. |

Neither probe writes. The iOS report also named a `DELETE` shape as the only
one that passes validation, and that arm is deliberately not run: it would
deregister one of the household's real phones to confirm a convenience.

What this pair is really about is cost asymmetry. Nineteen days of a roadmap
gap, and a documented per-id read that silently returns the wrong device, both
resolved by GETs anyone could have run at any point. **The reason they waited
was not difficulty, it was that nobody had written the probe** — the same
shape as `manage_plugin_interfaces`, which waited seventeen days for two calls.
A claim with a reproduction in it is already most of a probe; the remaining
step is small enough that it should not be a separate decision.

<!-- END manual ledger -->


## Where a confirmed item goes

| Scope | Home |
|---|---|
| Applies to one tool | that tool's description |
| Cuts across tools, unguessable, and costly | server instructions — but only if verified here; the bar is higher because every session pays for it |
| A behaviour of HC3 rather than this server | the description of whichever tool a caller hits it through |
| Refuted | stays in this file, marked refuted, with the evidence |
