# Friction triage

_Generated 2026-08-13 16:15 UTC from 7 entries at `/var/lib/hc3-mcp/friction.jsonl`._


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


## Recurring failures — 1 distinct


A tool failing the same way repeatedly is usually a missing or wrong
description rather than user error. High counts against one tool are the
cheapest wins available.


| Verdict | Count | Tool | Last | Message |
|---|---|---|---|---|
| untested | 7 | `upload_icon` | 0d ago | upload_icon: category "device" requires deviceTemplate — the Fibaro device type the icon is filed under, e.g.  |


## Submitted findings — 0


_None. Agents can add one with the `report_finding` tool._


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
| **untested** | HC3 holds the timer, not the scene instance; the instance may exit with a timer pending | The reporting project's own provenance note says this was never deliberately tested. See "scene timer model" below. |
| **untested** | When a timer fires, HC3 restarts the scene; the callback runs in a fresh instance | `scripts/probe-scene-timer.mjs` exists to settle it. |
| **untested** | Closure captures are gone in the callback; `if token == savedToken` fails silently | The **strongest evidence offered**, and the better thing to measure — see below. |
| **untested** | `quickApp` global is unassigned until after `onInit` returns | Cheap to probe. |
| **untested** | `getVariable` returns `""` not nil for a missing variable | Cheap to probe; a classic nil-check bug source. |
| **untested** | Multi-select delivers the selection nested one level: `{values={{"id1","id2"}}}` | |
| **untested** | Manual run detection: `trigger.type == "user" and trigger.property == "execute"` | |
| **untested** | Cron needs `matchInterval`; plain `match` with a 6-element array "does not fire reliably" | A reliability claim needs repetition, not one observation. |
| **untested** | `Style.color` is ignored on 5.210.12; carry state in caption text | Already recorded as not-adopted in 4.16.0. The new report adds a firmware number but still no isolation test. |
| **untested** | FGS-2x3: params 10/15 are operating mode (0 disables); time params 12/17 at 0 mean 0.1s, not disabled | Check the device manual first — that is free. |
| **untested** | FGR223 unresponsive-but-confirmed means lost calibration after a power cut; HC3 reports stale position | |

#### Conflict to resolve

| Verdict | Claim | Conflict |
|---|---|---|
| **untested, conflicting** | Named `uiCallbacks` dispatch as `method(self, event)` with `{eventType, elementName, values, deviceId}` | This repo **verified the opposite at creation time** (4.15.0): a supplied `{name:"modeSelector", eventType:"onToggled", callback:"modeSelection"}` comes back as `{eventType:"onReleased", callback:"uimodeSelectorOnReleased"}` — named callbacks are discarded. Both can hold if the rewrite happens only on create and a later edit sticks. One probe settles it, and until it does the two records contradict each other. |

#### Agreed, no test needed — design and practice

`fibaro.alert("push", {ids}, msg)` takes **user** ids while `api.post("/mobile/push")` takes **iOS device** ids, and the wrong kind fails silently; interactive push needs `category = "YES_NO"` (`"STANDARD"` → 400, omitted → 500); never bare-`pcall` a notification call. Marked empirically verified by the reporter on 25 July, and the 400/500 specificity reads as real testing. **This server has no push-sending tool at all**, so the knowledge currently has no home here — `get_ios_devices` is the tool that would supply the device ids.

Also agreed as sound design rather than gateway facts: closure-free callbacks as the workaround; the `delayUntil` / `schedDrain` persist-intent-and-re-derive pattern (correct whether or not the restart model holds, which is the best thing you can say about a design resting on an unverified mechanism); `self.properties.*` being effectively read-only; any class method being publicly callable via `fibaro.call` and REST; `QuickAppChild` for derived metrics; scene variables over globals; boolean flags defaulting to the safe behaviour; and the eight-step pipeline with an independent step 8.

Out of scope for this repo, not wrong: RoomManager 4742 as the control point, `config.lua` as canonical id source, the first-touch rule. Those are that project's conventions, not HC3 behaviour.

### The scene timer model — how to settle it

The three timer claims are one mechanism, and the reporting project is right that
it has never been proved. `scripts/probe-scene-timer.mjs` tests it two ways:

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
- `update_quickapp_file` still echoes HC3's PUT response — the smaller sibling
  of the scene response amplification fixed in 4.18.0.

<!-- END manual ledger -->


## Where a confirmed item goes

| Scope | Home |
|---|---|
| Applies to one tool | that tool's description |
| Cuts across tools, unguessable, and costly | server instructions — but only if verified here; the bar is higher because every session pays for it |
| A behaviour of HC3 rather than this server | the description of whichever tool a caller hits it through |
| Refuted | stays in this file, marked refuted, with the evidence |
