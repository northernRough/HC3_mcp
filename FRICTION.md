# Friction triage

_Generated 2026-08-13 17:36 UTC from 12 entries at `/var/lib/hc3-mcp/friction.jsonl`._


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
| untested | 12 | `upload_icon` | 0d ago | upload_icon: category "device" requires deviceTemplate — the Fibaro device type the icon is filed under, e.g.  |


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

<!-- END manual ledger -->


## Where a confirmed item goes

| Scope | Home |
|---|---|
| Applies to one tool | that tool's description |
| Cuts across tools, unguessable, and costly | server instructions — but only if verified here; the bar is higher because every session pays for it |
| A behaviour of HC3 rather than this server | the description of whichever tool a caller hits it through |
| Refuted | stays in this file, marked refuted, with the evidence |
