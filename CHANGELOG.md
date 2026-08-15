# Change Log

All notable changes to the "hc3-mcp-server" package will be documented in this file.

## [4.21.3] - 2026-08-15

### Fixed
- **`call_ui_event` does not dispatch the way a finger does, and two tool descriptions presented its behaviour as HC3's.** Measured by the new `scripts/probe-uicallbacks.mjs`: twelve cells fired through the tool, then the same elements tapped in the iOS app.

  | | `call_ui_event` | a real tap |
  |---|---|---|
  | handler called | the name registered in `uiCallbacks` | **always `UIAction`** |
  | arguments | ONE table `{eventType, elementName, values, deviceId}` | **positional** — `(eventType, elementName[, values])` |
  | trace emitted | `UIEvent:` | `onAction:` |

  Twelve tool-fired cells were table-to-the-registered-name, buttons and selects alike; eighteen taps were positional-to-`UIAction`, buttons and selects alike. No mixed cells in either direction.

  The tool is the more generous path on both axes, which makes it a trap precisely where its own description recommended it: **as a verification step**. A QuickApp verified through it can be completely dead under a finger. Both descriptions now carry the table, and `call_ui_event`'s says plainly what it is and is not evidence for.

- **`modify_device` claimed a written-back named callback "is dispatched".** True only through `call_ui_event`. The claim entered the description from a 13 August result established with that tool, so the record agreed with itself and with nothing a user does. Now qualified, with the workaround stated: handle the event in `UIAction` as well.

### Added
- **`scripts/probe-uicallbacks.mjs`** — crosses element kind (button/select) with registered callback (a name / `UIAction`) with binding time (at creation / written back / written back with no restart). Every handler logs its own name, argument count and argument types, so the signature is read rather than inferred. `--hold` keeps the QuickApps alive for a human to tap and compares the two channels, which is the only reason the difference was found. All QuickApps are deleted in `finally`.

- **Two behaviours nobody had recorded**, both from the same run and both now on the tools that expose them: `create_quickapp` normalises the **eventType** as well as the callback (a select registered `onToggled` returns `onReleased`), and a written-back binding needs **no restart** to take effect. The second settles a variable a field report had explicitly left open, in the direction it did not guess: the write was sufficient, the restart incidental.

### Changed
- **FRICTION.md records the refuted model, not just the answer.** A reconciling model was proposed in the ledger and killed by the probe. It is left in place with the evidence, because it was wrong in the way worth remembering: it explained every observation available, and every one of those had come through the same tool.

## [4.21.2] - 2026-08-15

### Fixed
- **`get_icon` could not fetch user-uploaded device icons, and then told the caller they were unfetchable.** The candidate paths omitted one segment. User device icons live at `/assets/userIcons/devices/User<N>/User<N>[state].<ext>`; the tool tried `/assets/userIcons/User<N>/...`, which HC3 answers with its SPA index rather than a 404, so every attempt failed the placeholder guard and fell through to an error asserting *"user-uploaded device icons are not served under any known /assets path on 5.210.12 — not fetchable as a file."*

  That claim was false, and 4.21.0's own release note already named this defect in the abstract ("user icons were concluded unrenderable on 12 August, which was false") without the path ever being corrected. It cost the reporting project three days of abandoned custom artwork. Re-probed against 5.210.12 on 15 August, unauthenticated, since `/assets` needs no credentials:

  ```
  /assets/userIcons/devices/User1072/User1072.svg → 200 image/svg+xml 2969   (the icon)
  /assets/userIcons/User1072/User1072.svg         → 200 text/html    13047   (SPA index)
  ```

  The segment is user-only: `/assets/icon/fibaro/devices/zraszacz/zraszacz0.png` returns the 1888-byte placeholder, so built-in device icons keep the layout they had. Both state-suffixed and bare files sit under it, matching what `upload_icon` has documented as HC3's storage model all along — the two halves of the same file disagreed.

  The false claim is removed from the error text and the tool description, and the error now names the path family it tried plus the two things that actually go wrong (a wrong `fileExtension`, or a state set needing `state`).

- **`unit-icon-paths.mjs` was asserting the wrong claim**, requiring the error to match `/not served under any known/`. A test that pins a defect in place is worse than no test, so it is replaced by one that fetches a user device icon under the correct segment, checks the state-suffixed form, and asserts the built-in layout does *not* gain the segment. Reported via `report_finding` against `get_icon` and `upload_icon` on 15 August; both are now confirmed.

## [4.21.1] - 2026-08-15

No runtime change. `src/` is untouched since 4.21.0, so the published tarball is functionally identical; this release exists to carry the test-harness fix below through the release path that should have caught it.

### Fixed
- **The golden-snapshot check could not see description drift, and four releases shipped a stale snapshot straight through it.** `phase0-parity.mjs` compared `inputSchema` and never `description`. Every drift in 4.19.2, 4.20.0, 4.20.1 and 4.21.0 was description-only, so the check reported `Parity: PASS` on all four. Verified by hand rather than assumed: replacing a tool's description with `WRONG` and running without `--update` still exits 0.

  CI caught the staleness only because its hygiene job regenerates with `--update` and diffs with git, which is a workaround for the check not doing its own job. A tool's description is its interface to the model, so drift there is drift. The comparison now covers both fields and names which of the two moved (`drift: create_scene (description)`).

- **`release.yml` re-ran lint, `npm test` and `check-release-hygiene.mjs` under the comment "Same gates as CI", but not the golden step.** That is how 4.19.2, 4.20.0 and 4.21.0 published green while CI had been red on master since 13 August. Fixed indirectly and permanently by the `npm test` change below, rather than by adding a step that can fall out of sync again.

### Added
- **`--check` mode on `phase0-parity.mjs`.** Total equality against the committed snapshot, with a tool added since the snapshot counted as staleness too, and it never writes. `--update` and `--check` together are refused as contradictory. Because it no longer needs git to detect drift, the gate can run anywhere.
- **`npm test` runs `phase0-parity.mjs --check` first**, inside the existing `MCP_FRICTION_DISABLE=true` scope so it cannot pollute the friction log. One line puts the gate in the local loop before a push, in CI's four-version node matrix, and in the release, since `release.yml` already runs `npm test`.

### Changed
- **`README.md` corrected where this change made it wrong.** It described phase 0 as checking "name parity" and the CI golden step as catching "a schema edit", both of which understated the check and neither of which would have caught the drift that actually shipped. It also told the reader to run phase 0 manually before a merge, which `npm test` now does for them; it now points at `--update` as the thing to run after an intentional tool change, which is the step that was actually being missed.

## [4.21.0] - 2026-08-14

### Changed
- **report_finding is now an expectation, not an offer.** Its description explained the format well and never said *when* to call it, so it read as available rather than expected. The cost is measurable: four defects were found in one night by this server's own telemetry, and **not one was reported by the session that hit it** — each was noticed, worked around, and left behind, because working around a problem feels like resolving it.

  Three changes, in descending order of effect.

  **1. The server instructions now set a standing expectation.** They are the only channel that lands before a tool is chosen, so it is the only place that can ask for something rather than wait to be discovered. The load-bearing instruction is *same turn*: file it when you find it, not at the end of the session, by which time the exact error text and the sequence that produced it are gone. It also says not to ask permission and not to wait to be asked, and that an un-isolated finding marked "not isolated" is wanted, because a postponed finding is a lost one.

  **2. The triggers are named, because "surprised you" does not fire reliably.** A tool that worked becomes unavailable; a documented path or parameter turns out wrong; a write reports success and a read-back disagrees; you find a working method this server does not document; **you conclude a capability is impossible**; you build a workaround because a tool was missing or refused. That fifth one is the expensive case and nothing previously prompted it: a wrong negative conclusion is recorded as settled and steers every later session away from something that works. This project has already shipped one — user icons were concluded unrenderable on 12 August, which was false. It is also the only case worth raising with the user, since only they know what was abandoned on the agent's say-so.

  **3. Errors now ask for the finding at the point of pain**, which is where one is cheapest to write and likeliest to be skipped. The prompt is **selective**: `invitesAFinding` fires on gateway errors, post-write verification failures and unexpected internal errors, and stays silent on this server's own deliberate refusals. Firing on every refusal would fill the friction log with the guards working correctly and train everyone to ignore the line. A verification failure is the case that must not be missed — it is phrased like a local refusal because this server raises it, but it means the write said yes and the read-back said no.

- **The instructions cap is raised from 3000 to 4200 characters, and the argument is recorded in the test.** Every previous addition was funded by cutting an existing fact, twice by consolidating the icon rules rather than lifting the cap. This one is different in kind: the protocol is not a fact competing with other facts, it is the mechanism by which the facts get corrected. `unit-instructions.mjs` now carries that reasoning next to the assertion, so the next person to add a line knows the rule is still "fund a new fact by cutting one".

### Added
- **`invitesAFinding` and `FINDING_NUDGE` in `friction.ts`**, with `unit-error-shape.mjs` asserting both sides: a 400 from the gateway and a `post-create name mismatch` invite a finding; `upload_icon: category "device" requires deviceTemplate`, a patch refusing a non-unique `old`, and `Fibaro HC3 not configured` do not. Kept in `friction.ts` rather than the server module so a test can import the predicate without booting a server.

## [4.20.1] - 2026-08-14

### Fixed
- **`create_scene` handed a structured `conditions` block straight to HC3, which stored it and then died on it.** Raised by live telemetry rather than by anyone reporting it: a real call on the deployed server drew `400 SceneValidationError` with `engine.lua:623: attempt to concatenate a table value (field 'conditions')`. That message names a line in **Fibaro's** engine and says nothing about which argument was wrong, so the caller is left debugging someone else's Lua.

  Reproduced first, on 5.2x: conditions as a structure fails exactly so, the same scene with a Lua source string is accepted and stores cleanly. The cause was this tool's own convenience path — `content` given as an object is `JSON.stringify`'d, so a caller who supplies the conditions **table** as JSON (the natural reading, since every conditions example in circulation is a Lua table) produces `{"conditions":{...}}` where HC3 wants Lua source text.

  Both blocks are now validated before the request, on **both** ways in: an object `content`, and a JSON-string `content` — the latter being the path the telemetry actually arrived by. `update_scene_content` gets the same guard, where `conditions?: string` was a TypeScript annotation with no runtime check behind it.

  The refusal prints the Lua the caller meant, rendered by a new `toLuaSource` helper. It deliberately does **not** convert on their behalf: a scene that validates but behaves subtly differently from what was intended is worse than a refusal on a controller wired to a real house.

- **`create_scene`'s description now states the shape instead of implying the opposite.** It previously said only that an object `content` is JSON.stringify'd, which reads as an invitation to pass the structure. It now shows a conditions block as the quoted Lua string it has to be.

### Added
- **`scripts/probe-scene-conditions.mjs`** — the three-arm reproduction (Lua source string, JS object, JSON string), with scene teardown in `finally`.
- **`unit-scene-conditions.mjs`** replays the live failure through both tools and both content forms, and asserts the guard lets a valid scene and a plain Lua body through untouched. The fake client throws on any request, so a case that should be refused locally cannot pass by silently reaching the gateway.

## [4.20.0] - 2026-08-14

### Added
- **`get_hc3_lua_scenes_guide({topic:"execution_model"})` — how the engine actually runs a scene.** The guides shipped since the fork restated Fibaro's documentation, which is the one thing a newcomer can already find. This topic carries what the documentation does not: a scene is a conditions table the *engine* evaluates plus a Lua body, one instance runs at a time governed by `restart` (`maxRunningInstances` is an HC2 leftover reading a constant 2, never write it), `matchInterval` is the periodic form confirmed in production, `sourceTrigger` and `sceneId` are free globals, manual runs are `type == "user"` **and** `property == "execute"`, and there is a table of HC2 habits that do not transfer so they can be recognised and rejected when they surface in old forum posts or model memory.

  It also kills a myth. The widely repeated claim that a firing `fibaro.setTimeout` restarts the scene from the top, losing closures, is **false**, and it is now tested twice on two gateways by two people. A field report settled it first (two scratch scenes, three runs, 5.210.12). `scripts/probe-scene-timer.mjs`, written here to answer exactly this question, was then run and agreed on every arm: the no-timer control scored one top-of-scene execution, the timer arm scored one with its callback firing, and the closure arm saw `INSTANCE-1` — the value captured by the run that armed the timer, not nil and not a later instance's. That third outcome is the one that produces the reported symptom while looking like closure loss, and it did not occur. The claim had produced a whole style of defensive scene code; the persist-and-re-derive pattern is now presented as a durability choice for work measured in hours, not as a requirement for a thirty-second debounce.

- **`get_hc3_quickapp_programming_guide({topic:"gotchas"})` — the platform behaviours that break competent Lua.** The `quickApp` global reports `type` `userdata` with a `tostring` of `custom [luabind::detail::null_type] object: (nil)` **while being fully usable**, so `if quickApp == nil` and any `tostring` check both lie. `getVariable` returns `""` for a missing variable and for one deliberately set to `""`, indistinguishably — the only signal is an HC3 log line the Lua cannot see. Coroutines are unavailable, which invalidates the common `coroutine.yield` wrapper that makes `net.HTTPClient` look synchronous. `createChildDevice` takes `initialProperties`/`initialInterfaces` with the class as its second argument, HC3 assigns the id, and `initChildDevices` must run first or every restart creates duplicates.

- **`get_hc3_programming_examples({category:"patterns"})` — components rather than scenarios.** Eleven self-contained blocks that lift straight into a scene or QuickApp: trigger parsing with a manual-run guard, a scene-variable store with safe init, logging enriched with room names, a restart-safe scheduler, window gating with a force override, a daily computation cache, a polling loop with backoff and jitter, a callback-based HTTP wrapper, a child-device factory with the persisted id map HC3 forces on you, rolling averages, and a default scene skeleton. Every installation-specific id from the source material was replaced with a placeholder.

### Changed
- **The four `get_hc3_*` descriptions now say when to call them and what is inside.** They previously read like a table of contents (*"Get comprehensive HC3 configuration documentation including network settings, users, rooms, Z-Wave setup, etc."*), which gives a model no reason to spend the tokens. Each now leads with the trigger condition — writing scene Lua, writing QuickApp Lua, building rather than looking something up — and names the specific corrections it carries.

- **The write tools point at the guide at the moment it matters.** `create_scene` and `update_scene_content` name the execution model, `create_quickapp` names the gotchas, and `get_quickapp_variable` explains that the tool can distinguish missing from empty when the QuickApp's own `getVariable` cannot. `modify_scene` now documents `restart` as the real concurrency control and `maxRunningInstances` as vestigial, since it accepts both.

- **One line added to the server instructions, funded rather than appended.** The file was at 2999 of its 3000-character cap, so the guide pointer was paid for by tightening six existing bullets; it now sits at 2963. It asserts the timer finding, which it is only entitled to do because the probe was run here first — the stated bar for that file is gateway-verified-*here*, and a field report, however well documented, does not clear it. The draft that pointed at the guides without the claim was the correct text right up until the probe returned.

### Fixed
- **FRICTION.md: five untested claims settled, three of them refuted.** The reporter tested the timer model on their own gateway and refuted their own earlier report; the probe this project built to settle those rows was then run here and agreed, on scratch scenes 794/795/796, all torn down. Two independent gateways, two independent methods, same answer. The `quickApp` and `getVariable` rows are confirmed with better detail than the original claims carried. Two new claims arrived attributed rather than tested — scene variables having no REST API, and coroutines being unavailable — and are recorded as untested, with the first flagged because it decides whether the "no scene-variable tool" gap is closable at all.

## [4.19.2] - 2026-08-13

### Fixed
- **`upload_icon`'s schema demanded the argument its own handler refuses.** `required` was `['base64', 'mime', 'category']`, but a device icon for a state-set type (a relay, a dimmer) must be passed as `states`, and the handler rejects `base64` alongside it and rejects `base64` on its own for those types. So a client that obeyed the schema was guaranteed a refusal, and a client that ignored it was violating a stated requirement. `required` is now `['mime', 'category']`, with an `if`/`then`/`else` that asks for `deviceTemplate` plus one of `base64`/`states` on a device upload, and `base64` alone for a room or scene.

  This is the tool behind **every friction entry recorded against this server** — 12 of 12, all of them the "category device requires deviceTemplate" refusal. The requirement was documented all along, in the second paragraph of a ~4,000 character description, behind the 128×128 rule. A conditional requirement belongs in schema, where a client can act on it before the call, rather than in prose it may never weigh. The two decisions that actually determine whether the call succeeds now open the description instead of trailing it.

- **The property descriptions contradicted the tool's own findings.** `base64` still told callers PNGs must be "palette mode (8-bit colormap, color type 3)", which 4.13.1 refuted on the gateway (colour type does not matter; RGBA is what most existing icons use) and which the main description already said. It also claimed device icons always use `states`, when a `com.fibaro.genericDevice` tile takes a single `base64` image. `states` claimed a device upload without it is refused, which is not what the handler does.

- **An unwritable `MCP_FRICTION_LOG` fell through to the next candidate.** Setting the variable says *where* telemetry goes; it is not a first preference. When the named path could not be written, the resolver moved on and wrote to `~/.hc3-mcp/friction.jsonl` instead. The cost was not hypothetical: `unit-friction.mjs` sets the variable to a deliberately unwritable path to prove telemetry never throws, so **every `npm test` run appended two fixture entries to the developer's real log** — 12 of the 17 entries on this machine came from a tool named `t` with the message "should be swallowed". A metric that records its own test suite cannot be trusted to describe users. An explicit path is now used or telemetry disables itself, and the test asserts that rather than merely commenting it.

- **`npm test` disables telemetry for the whole run.** The leak above was one route in; three test files (`unit-upload-icon`, `unit-upload-icons`, `unit-error-shape`) exercise failing tool calls and none of them redirected telemetry, so the next such file would have re-opened it. `MCP_FRICTION_DISABLE=true` now wraps the suite, and `unit-friction.mjs` opts back in explicitly, which also makes it hermetic when run by hand in a shell that has the variable set.

- **`npm run triage` refuses to regenerate a file that came from a different log.** The header already recorded which log a generation came from, and the telemetry path is per-machine: `/var/lib/hc3-mcp` on the deployed unit, `~/.hc3-mcp` on a laptop. Running triage on the wrong one replaced the deployed unit's recorded friction with whatever the laptop held, and did it quietly, because the hand-written ledger is carried across and only the generated half changes. It now compares the two paths and exits non-zero naming both, with `--force` for when replacing it is the intent. `unit-triage.mjs` covers the refusal, the escape hatch, and that the ledger survives regeneration.

- **The `bin` entry was being dropped from the published package.** `npm publish` warned `"bin[hc3-mcp-server]" script name out/mcp/hc3-mcp-server.js was invalid and removed` — the leading `./` in the path is rejected by npm 11, so the tarball would have carried no executable and `npx @northernrough/hc3-mcp-server` would have failed for anyone installing it. Caught only because a release run got far enough to warn, which is an argument for releasing more often rather than for reading more warnings.

### Changed
- **4.19.2 is the first release published this way, and the first with a signed provenance statement.** Getting there took four failed runs, each with a different cause and each worth recording: an npm token that could never work (`EOTP`), `setup-node`'s `registry-url` writing a placeholder `_authToken` that made npm skip the OIDC exchange entirely (`E404`), no trusted publisher registered on the package (`ENEEDAUTH`, with the real reason visible only under `--loglevel verbose`), and a `bin` path that npm silently dropped. Not one of those failures named its own cause in the default output.

- **The release workflow publishes by trusted publishing (OIDC), not a token.** Every token attempt failed at the publish step with npm's `EOTP`: a classic Publish token, then a replacement, both rejected because 2FA on writes refuses any credential without an explicit bypass — a classic *Automation* token, or a granular token with "Bypass 2FA" enabled, which is off by default and which the workflow's own setup comment did not mention. The runner now proves its identity with a short-lived GitHub OIDC token instead, so there is no secret to choose wrongly, rotate or leak, and provenance attestations come for free. Needs npm >= 11.5.1 and Node >= 22.14.0, so npm is upgraded explicitly rather than inherited from the runner image, and a preflight step checks the job really holds `id-token: write` by testing for the OIDC endpoint rather than trusting the permissions block. The comment block also now records that **GitHub creates no event at all when more than three tags are pushed at once**, which is why pushing four tags published nothing and produced no warning.

- **`MCPTool.inputSchema` accepts JSON Schema conditionals** (`if`/`then`/`else`, `anyOf`/`allOf`/`oneOf`). The type previously allowed only `type`, `properties` and `required`, which is why a dependent requirement had nowhere to go but prose.

## [4.19.1] - 2026-08-13

### Fixed
- **A numeric tool argument sent as a string produced silently wrong results.** Found on the live gateway during the first read-only verification pass of the 4.18/4.19 work — which is the entire argument for running one.

  `get_quickapp_file(contains: "quickAppVariables", contextLines: 0)` returned **895 lines** for a two-line match, while correctly reporting `matchCount: 2`. The client had sent `contextLines` as the string `"0"`, so `h + contextLines` concatenated instead of adding: for the hit on line 7, `7 + "0"` is `"70"`, turning a zero-line window into lines 7–70; for the hit on line 685, `"6850"` clamped to the end of the file. Union: 895 lines. Wrong, large, and with no error anywhere — the exact shape this server exists to refuse.

  The arithmetic is what gave it away. Moving `contextLines` from `0` to `1` changed the selection by **3** lines, which no correct implementation and neither of the first two hypotheses could produce; only the concatenation model predicts 895 and 898 exactly, and it reproduces both.

  All four numeric inputs to `excerpt` (`startLine`, `endLine`, `contextLines`, `maxLines`) are now coerced and range-checked before any arithmetic, and a non-numeric value is refused rather than silently coerced to nonsense. A patch edit's `count` is coerced the same way — it was already loud rather than wrong, but refusing `"2"` from a client that means 2 was a papercut with no upside.

  This was never a stale-schema artefact. Any JSON-RPC client may send `"3"` where the schema says `3`, so the server must not do arithmetic on an unvalidated argument. `unit-excerpt.mjs` now replays the exact live failure — 1,515 lines with hits on 7 and 685, across `0`, `"0"`, `1`, `"1"`.

### Changed
- **The server instructions no longer say "reconnect the session" after a redeploy — they say start a new one.** The old line was wrong in a way that cost time twice in one day. Three reconnects failed to refresh a client's tool list: the transport reconnected, the cached `tools/list` was reused, and tools added in 4.18/4.19 stayed uncallable while `get_server_info` cheerfully reported the new version. That version check is the trap, not the remedy — it reads live server state and looks correct precisely when the schemas are stale, so it cannot detect the condition it appears to confirm. Both facts are now in the line, funded by tightening the icon-naming rule rather than raising the character cap.

- **`pi-update.sh` prints the deployed commit and the built-file hash when it finishes.** Diagnosing the above cost three round trips to the Pi to establish that the deployment was not at fault. Worse, a silent `npm run compile` failure would leave the service reporting a new version from `package.json` while running old code — "reports success, did not do the thing", which is the failure this project guards against everywhere except, until now, its own deploy script.

### Verified against the live gateway
The rest of the read-only pass confirmed the 4.18/4.19 work against real data, closing the "not yet verified" caveat on everything except the patch tools:

- `get_scene(block:"conditions")` returns parsed Lua directly — 330 bytes, no JSON-in-JSON double parse. `block:"actions"` reports 72,198 of scene 645's 75,428-byte content across 1,647 lines.
- `contentHash` is stable across four calls with different parameters, confirming it hashes the whole body regardless of the excerpt requested, and is returned even when the body is omitted.
- Line-range reads returned 12 lines of a 1,647-line scene and 10 of a 1,515-line file for a few hundred bytes.
- A search that misses explains itself rather than returning an empty response.

`patch_quickapp_file` and `patch_scene_content` remain unverified against real data: new *parameters* pass through a client's cached schema, but new *tools* cannot be called until the session reconnects.

### Confirmed from the field report, at no cost
Scene 645's live `conditions` block contains exactly the cron and manual-run forms the reporting project described, in production use on a working scene:

```lua
{ isTrigger = true, operator = "matchInterval", property = "cron",
  type = "date", value = { date = {"*","*","*","*","*","*"}, interval = 60 } },
{ isTrigger = true, property = "execute", type = "user" }
```

Two ledger rows move from untested to confirmed. Their separate negative claim — that plain `match` with a 6-element array "does not fire reliably" — is untouched by this and remains untested.

## [4.19.0] - 2026-08-13

Acts on a five-item field report from the project that builds scenes and QuickApps through this server, run against 4.17.0 on 5.210.12. Every item was isolated by the reporter with a scratch QuickApp created and deleted for the purpose. Two were re-verified here before adoption; the rest were confirmed against this repo's own source.

### Changed
- **`call_ui_event` returns a receipt instead of nothing.** HC3's `callUIEvent` answers with an empty body: no acknowledgement, no echo, no indication that a callback was even bound to the element. That is the silent-success shape the rest of this server closes, and it matters more here than elsewhere because this is the tool reached for *as* a verification step — the reporter only knew their event had landed because they had planted a log line to catch it.

  The tool now reads the device's `uiCallbacks` **before** dispatching and reports the matched entry as `boundCallback`. A null there warns that the event will likely go nowhere; it does not refuse, because HC3 may still route to a generic handler. A failed lookup is reported as `bindingLookupError` rather than being misreported as "unbound" — not knowing is not the same as knowing it is absent.

- **`update_quickapp_file` and `update_multiple_quickapp_files` return hashes.** Both previously handed back HC3's PUT response, which carries `{name, isMain, isOpen}` and no content — so the push result could not serve as the verification and callers had to fetch again to byte-compare. Both tools *already* re-fetched every file to verify the write and then discarded what they read. They now return `bytes` and `contentHash` per file, comparable directly against `get_quickapp_file`'s `contentHash`. `update_quickapp_file` called without `content` reports `verified: false`, since nothing was compared.

- **`modify_device` records the verified way to restore named `uiCallbacks`.** 4.15.0 verified that `create_quickapp` cannot keep them — HC3 rewrites a supplied `{name:"modeSelector", eventType:"onToggled", callback:"modeSelection"}` into `{onReleased, uimodeSelectorOnReleased}` at creation. The reporter has now tested the other half: writing the named array back through `modify_device` **sticks**, survives a later `update_multiple_quickapp_files` push with the `uiCallbacks` modified timestamp unchanged, and dispatches the named method with `{eventType, elementName, values, deviceId}`. The recommended fix is therefore confirmed end to end rather than merely advisable. The description now also says to read it back afterwards, because the read is cheap and the failure mode is silent.

  **This resolves the conflict logged in FRICTION.md**: both records were true, and the create-time rewrite is the only place it happens.

- **`call_ui_event` documents HC3's undocumented `UIEvent:` trace line.** HC3 emits a trace-level line tagged with the QuickApp, carrying the same event table, immediately before dispatch — so the UI event path can be confirmed from `get_debug_messages` with nothing instrumented in the QuickApp at all. **Re-verified here independently** and read-only, from the residue of the reporter's own probe: `UICBPROBE trace UIEvent: {"values":[],"deviceId":4950,"eventType":"onReleased","elementName":"modeSelector"}`.

  The same log distinguishes the two callback styles, which is worth more than it looks: a named callback dispatches to its own method, while an auto-generated one appears as `onAction: {"actionName":"UIAction","args":["onReleased","<elementName>"]}`. Both shapes were visible side by side on this gateway.

- `unit-ui-event.mjs` — 11 checks covering the binding lookup ordering, the no-refusal rule, the failed-lookup case, and that a write receipt's hash matches what a read would report.

### Known gaps, not closed here
The report's fifth item names two, and both are real. **There is no push tool**, so the verified routing rule — `fibaro.alert("push", …)` takes USER ids, `POST /api/mobile/push` takes mobile DEVICE ids, and the wrong kind fails silently at both ends — has nowhere to live, even though `get_ios_devices` already supplies half the ids. **There is no scene-variable tool**, so `fibaro.getSceneVariable`/`setSceneVariable`, the backbone of the restart-safe scheduler pattern, are unreachable from here.

Neither is being guessed at. A push tool built on an unverified request body, or a scene-variable tool on an endpoint that might return 501 like the others in `KNOWN_DEAD_ENDPOINTS.md`, would be exactly the "plausible and wrong" shape this project keeps having to reverse. Both want their request and response shapes pinned against the live gateway first.

## [4.18.0] - 2026-08-13

Acts on a field report asking for patch-based editing. The report's core diagnosis is right and is confirmed in the code: the write path expresses **replacements** rather than **changes**, so the cost of an edit is proportional to the size of the file rather than the size of the change, and above a certain size the write tools stop being usable at all. This release works through the whole of that report — patching, concurrency guards, partial reads, and the two validation asks — and records the corrections and the parts still untested rather than only what was adopted.

### Changed
- **`update_scene_content` no longer returns three copies of the scene body.** It returned `previous`, `current` **and** the full scene record. Measured on this gateway, scene 645 carries a `contentLength` of **75,428 bytes**, so a one-line change cost roughly 75 KB in and ~225 KB out — enough to exhaust a context window on its own, and a better explanation than request size for why a diagnosed one-line fix went unshipped for days.

  The default response now carries lengths plus an md5 of the raw `content` string as HC3 stored it, and strips `content` from the scene record the way `get_scene(includeContent=false)` does. **`returnContent: true` restores the old shape exactly**, for callers that specifically want a last-known-good copy inline.

  The tradeoff is stated plainly because it is a real one: the previous shape existed so a caller always had a recovery copy, and that is no longer handed over by default. A caller that wants one should read the scene before writing. An amplification that makes the tool unusable on a real scene is not a safety feature.

### Added
- **`patch_quickapp_file`.** Supply only the text to change. Each `old` must match exactly `count` times (default 1); any other number aborts the **whole** patch before anything is written, including edits earlier in the same list. That refusal is the feature: a complete file is always a structurally valid thing to write, so a whole-file PUT cannot distinguish a real change from a truncated paste or a stale copy — which is how a file containing the literal text `-- placeholder` reached a live controller and cost it its 60-second tick. An edit that does not fit its file is self-evidently wrong and can simply be refused.

  Edits are applied to an in-memory copy and written once through the same endpoint `update_quickapp_file` uses, then re-fetched and compared byte for byte. `dryRun: true` returns the diff with no write at all. The response carries a unified diff, before/after sizes and an md5 — and **not** the file: on a 2,000-line file the response is under a twentieth of the body, and stays flat as the file grows.

  A zero-match refusal distinguishes the two causes rather than leaving the caller to guess: if a whitespace-insensitive search finds the text, it says the difference is whitespace; otherwise it says the copy may be stale. Too many matches reports the actual count and suggests setting it deliberately.

- **`src/mcp/patch.ts`** — `applyEdits` and `unifiedDiff` as dependency-free pure functions, so `patch_scene_content` can reuse both. The diff trims the common head and tail before the O(n·m) core, which is what keeps a one-line change in a 5,000-line file down to a handful of diff lines, and caps its own output rather than returning something as large as the file it describes.

- **`contentHash` in `util.ts`** — md5 of a stored body. Hashes whatever HC3 returned rather than what was submitted, so the value stays comparable across a later re-fetch. Groundwork for the `expectedHash` concurrency guard, which is not in this release.

- **`patch_scene_content`.** Same semantics on a Lua scene's `actions` or `conditions`, and scenes need it more: a QuickApp can be split across files to keep edits small, but a scene is one monolithic block with no equivalent escape hatch, so every scene edit otherwise pays the full 75 KB. The untouched block is carried across and **post-write verified as unchanged** — a patch to `actions` that moved `conditions` throws rather than reporting success. `sceneWasRunning` reports whether the scene was mid-run, and claims nothing beyond that.

- **`expectedHash` on both patch tools; `contentHash` from both getters.** `get_quickapp_file` and `get_scene` now return an md5 of the stored body (`get_scene` returns it even when the body itself is omitted). Pass it back as `expectedHash` and the patch refuses if the target moved in between. A QuickApp file or scene has no single writer — the web UI, the mobile app, another MCP session and the QA's own Lua can all write it.

- **Partial reads on `get_quickapp_file` and `get_scene`.** `startLine`/`endLine`, or `contains` for a line-numbered excerpt around every literal match, with `contextLines` and a `maxLines` cap. `totalLines` always comes back so a caller knows what it did not see, and the gutter line numbers quote straight back into a patch `old`.

- **`get_scene` can hand back parsed Lua.** `block: "actions" | "conditions"` returns the block directly, removing the JSON-inside-JSON double parse. Internally every scene tool now goes through one `parseSceneContent` helper instead of three hand-rolled try/catch blocks.

- **`modify_device` refuses a viewLayout whose selects would blank the tile.** Unlike the Lua check this one blocks, because the trigger is verified rather than heuristic (4.16.0, on 5.210.12): a `select` missing `selectionType`, or with `values`/`selectedItems` as an object rather than an array, is stored, reports verified, and then renders an empty tile with every other component gone. The refusal names each offending element and its field. `allowUnsafeViewLayout: true` overrides it.

- **A shallow Lua checker (`src/mcp/lua.ts`), warn-only.** Both patch tools report `luaWarnings` on the patched result. It is a lexer that blanks strings and comments and then checks bracket balance and `function`/`if`/`do` … `end` balance — deliberately not a parser, and it **never blocks**, because a false refusal on a device holding irrigation valves open is worse than the gap it closes. No dependency was added; a real parser would mean taking the first runtime dependency beyond `dotenv`, which is a larger call than this change should make. Most of `unit-lua.mjs` asserts that valid Lua produces *nothing* — `end` inside strings and comments, `elseif`, long strings, `repeat`/`until`, escaped quotes — since a false positive is the failure mode that matters.

- Tests: `unit-patch.mjs` (42), `unit-scene-content.mjs` (18), `unit-lua.mjs` (25), `unit-excerpt.mjs` (22), `unit-viewlayout.mjs` (18). The atomicity, dry-run and stale-hash claims are proved by asserting on the recorded request log — that no PUT was issued at all — rather than by inspecting the return value, since the whole subject here is writes that should not have happened.

### Not yet verified against the gateway
Everything above is unit-tested against fake clients only. The MCP instance connected during development was running 4.17.0, so the new parameters could not be exercised end-to-end on the live HC3 — the excerpt paths, `expectedHash`, and the viewLayout refusal need a redeploy and a pass against real data before they are trusted in the way the rest of this file's claims are.

### Corrected from the report
- **"Three files."** The gateway shows four on device 4933 (`main`, `watering`, `picker`, `icons`).
- **"58,591 bytes, roughly 30,000 tokens."** Lua runs about 3.5 characters per token, so that push is ~16–19k tokens. The figure is right only if the read is counted alongside the write.
- **"`get_scene` returns everything."** Out of date since 4.7.0: `includeContent=false` returns metadata plus `contentLength`. The real gap is that it is all-or-nothing — there is no `lineRange` — which is unaddressed here.
- **`expectedHash` ranked as the most important guard.** Demoted. Exact-match-`count` already covers most of the stale-copy case it was proposed for: if the file has drifted, `old` will usually not match and the patch refuses. It remains worth adding, one tier down.

### Not adopted (untested)
- **"HC3 restarts a scene to execute a timer callback, re-running it from the top."** Not reproduced here and not documented anywhere in this project. It is not load-bearing — strike it and the argument for patching scenes still stands on the other three grounds — so it is recorded rather than acted on.

  **`scripts/probe-scene-timer.mjs` now exists to settle it**, along with a `withScene` helper in `probe.mjs` (there was none, which is part of why this went untested). The single variable is the presence of the `setTimeout`; the control arm must score exactly one top-level execution or the run is inconclusive. The counter is sampled once before the timer is due and once after, so a second execution is tied to the callback rather than merely observed at the end. Both counters live in globals that are **created first**, because `fibaro.setGlobalVariable` silently no-ops on a global that does not exist (verified in 4.15.0) — skip that and every counter reads 0 and the probe looks like a clean refutation while measuring nothing. The debug log is read as an independent second witness.

  A **second arm measures closure survival directly**, which is the thing calling code actually depends on and a cheaper question than counting restarts. A local is captured by the callback and compared against what a fresh run would produce, separating three outcomes the restart count cannot: the closure survived intact; the upvalue was nil; or **the top re-ran and rebuilt the closure**, so a captured token now compares against the later run's value. That third case produces the reported symptom while looking like the second, and needs a different fix — not "avoid closures" but "never trust a value a re-entry would recompute".

  Not yet run: it needs gateway credentials, which the environment this was written in does not have.

### Added — FRICTION.md as a durable ledger
- **`FRICTION.md` now carries a hand-written claim ledger**, and `npm run triage` preserves it. The generator previously rewrote the file wholesale, so the first triage run after anyone wrote a ledger would have destroyed it — a poor showing for a file whose whole purpose is that findings do not get lost. Content between `<!-- BEGIN manual ledger -->` and `<!-- END manual ledger -->` is carried across regeneration; everything outside is regenerated from telemetry.

- The ledger's first entries review a consolidated set of learnings from the project that builds scenes and QuickApps through this server. **Two claims previously refuted here had returned in it** — that `filter_devices` needs `parentId` as a string (refuted on 5.210.12: `[1]` and `["1"]` both returned all 185 children), and that Z-Wave parameter writes only transmit from the web UI (`setConfiguration` does transmit and ships as `set_device_parameter`). Both are now recorded as refuted rows that stay in the file permanently, which is the entire point of it.

  Also caught: the claim that `setTimeout` argument order differs between scenes and QuickApps. Both signatures exist, but the axis is the **function name**, not the context — `fibaro.setTimeout` is delay-first everywhere, bare `setTimeout` is callback-first, and this repo's own examples use `fibaro.setTimeout(delay, fn)` inside QuickApp code. And a standing conflict: named `uiCallbacks` are reported to dispatch as `method(self, event)`, while 4.15.0 verified that HC3 discards named callbacks at creation. Both can hold if the rewrite happens only on create; one probe settles it.
- **Whether an external QuickApp *file* write restarts the QuickApp.** 4.15.0 verified this for *variable* writes. The file case is likely but has not been isolated here, so `patch_quickapp_file` does **not** report `restarted` in its response, as the report's suggested shape proposed. Its description says only what is known: batch multi-file changes into one `update_multiple_quickapp_files` call rather than N patches.

### Still outstanding from the report
`update_quickapp_file` still echoes HC3's PUT response — a smaller instance of the same amplification as the scene fix above. A real Lua parser (dependency decision) rather than the shallow checker. And the two untested claims above want a `scripts/probe.mjs` run each.

## [4.17.0] - 2026-08-12

### Added
A feedback loop, so the next person's hard-won lesson does not depend on them choosing to write a document — and so nothing gets adopted from one without being re-tested.

- **Friction telemetry + `hc3://friction`.** Every tool failure is recorded locally (redacted, size-capped, oldest-first truncation) and grouped by tool and normalised message, so the same fault about different ids lands in one bucket. Nobody opts in and nothing is transmitted. A tool failing the same way repeatedly is usually a description gap rather than user error — this would have shown `upload_icon` failing five times with `MISSING_PARAMETER` weeks before anyone wrote it up.

  Three rules, in order: it must **never break a tool call** (every write wrapped, every failure swallowed — a telemetry bug must not become an outage on a live home controller); it is **local only**, since HC3 error bodies carry device and room names; and it **redacts before writing**, because a secret that never reaches the file cannot leak from it later. Tests cover all three, including that it stays silent when handed an unwritable directory.

- **`report_finding` tool.** Lets an agent record a surprise while it still has the context. It **requires a reproduction, and refuses one under 40 characters** — in the last field report received here, two claims were wrong and one blamed the wrong cause, because two variables had been changed at once. The description says plainly that an unisolated finding which admits it is more valuable than a confident wrong one.

- **`scripts/probe.mjs`.** Throwaway QuickApps, icons and globals with teardown guaranteed in `finally`, plus a `single()` helper that runs both arms of a one-variable test and prints a verdict. Writing the reproduction was the expensive part; this makes it minutes. It exists partly because a `delete_icon` used as a reachability probe destroyed a live user icon on this gateway.

- **`npm run triage` → `FRICTION.md`.** Deliberately **not** a list of fixes: every row is a candidate with a verdict of confirmed / refuted / untested. **Refuted items stay in the file**, because a refutation that is not written down gets re-adopted by whoever reads the original report next — which is exactly how three claims were adopted and reversed here in one week.

- Server instructions gain one line inviting findings and stating the one-variable bar, funded within the existing character budget.

### Storage
`MCP_FRICTION_LOG`, else the first writable candidate; `MCP_FRICTION_DISABLE=true` disables it. Under a hardened systemd unit (`ProtectSystem=strict`, no `ReadWritePaths`) there may be nowhere persistent, in which case the log lives in a private `/tmp` and is wiped on every restart. The resource says which applies rather than pretending to have history.

## [4.16.0] - 2026-08-12

The reporting project re-tested its own document after the 4.15.0 response, withdrew two claims, and supplied a properly isolated reproduction for a third. That reproduction was **re-run here** before adoption — the same standard applied to their corrections as to their original report.

### Added
- **The `select` trap.** A QuickApp `select` element missing `selectionType`, or carrying `values` as a JSON object rather than an array, causes HC3 to **store the layout, report the write as verified, and then return an empty view** from `/plugins/getView` — the entire tile, with every other component gone, not just the offending element.

  Confirmed here with a single-variable test: one device, external `modify_device` PUT only, one field varying. Without `selectionType`, `getView` returned **0** components — the plain label alongside it vanished too. Adding `selectionType` as the sole change, both components rendered. Setting `values` to `{}` blanked it again; restoring the good layout brought it back.

  In Lua `values = {}` encodes as `{}` rather than `[]`, so `json.array()` is required — the same applies to `selectedItems` when clearing a multi-select. Recorded in the server instructions (within the existing budget, funded by tightening other lines rather than raising the cap) and in full on `modify_device`.

### Changed
- **`modify_device` records that an externally-PUT `viewLayout` DOES render.** The original report claimed a QuickApp must install its own view from Lua; the reporter withdrew that after testing, and this session's runs confirm it independently — every render above used an external PUT and nothing else. The claim was never adopted here, and `unit-instructions.mjs` now guards against it being added later from the original document.

### Not adopted (still untested)
Named `uiCallbacks` dispatching as `method(self, event)`, and `style.color` being ignored by the mobile app. The reporter explicitly declined to press either without an isolation test, having been caught once by a two-variable change. The second is app-side rendering rather than gateway or MCP behaviour and probably does not belong here at all.

## [4.15.0] - 2026-08-12

Acts on a field report from a project that built a ~1,300-line irrigation QuickApp against this server. Every claim was re-tested against the live gateway before being acted on; two did not survive, and are recorded here so they are not "fixed" later on the strength of the report alone.

### Changed
- **Tool failures now return `isError: true` content instead of a JSON-RPC protocol error.** The report's single biggest ask was "surface the HC3 status code and body" — and the server was *already* doing that: `hc3-client` throws `HTTP {status}: {statusText} - {body}`. The text was being lost at the *shape*: tool execution failures were returned as protocol errors (`-32000`), which many clients render as a generic envelope with the message discarded. That is how two days were spent seeing only `{"error": "Error occurred during tool execution"}` while the server was reporting chapter and verse. Protocol faults (unknown method, bad params) remain real JSON-RPC errors; `unit-error-shape.mjs` asserts both halves of the split.

- **`create_quickapp` — the `uiCallbacks` caveat is now VERIFIED, not "observed".** Confirmed live: a supplied `{name: "modeSelector", eventType: "onToggled", callback: "modeSelection"}` comes back as `{name: "modeSelector", eventType: "onReleased", callback: "uimodeSelectorOnReleased"}`.

- **The three QuickApp-variable tools now state that an external variable write RESTARTS the QuickApp** (verified: the QA bounced within 4s). It restarts once per call, so creating eight variables restarts it eight times, and a write issued after another restarting call may never run. `update_multiple_quickapp_files` remains the way to push several files in one restart.

- **`create_global_variable` records that `fibaro.setGlobalVariable` silently no-ops on a missing global.** Verified with a controlled test: the same QuickApp wrote an existing global successfully and a non-existent one to nothing at all — no error, no creation. That is how a heartbeat went into a void for a day with a watchdog watching and reporting nothing.

- **Server instructions gain the two cross-cutting facts** from the above: that a call which does not throw has not necessarily worked, and that external variable writes restart the QA.

### Not adopted (tested and refuted)
- **"`filter_devices` parentId values must be strings, not integers."** Refuted on 5.210.12: against a parent with 185 children, `[1]` and `["1"]` both returned all 185.
- **"The MCP does not surface HC3 status codes or bodies."** It does, and has; see the error-shape change above for what was actually wrong.

### Not adopted (not tested)
QuickApp UI behaviours from the report — that a view must be installed from within the QA, that a malformed `select` blanks the whole tile, that `style.color` is ignored by the mobile app, that empty Lua tables need `json.array()` — are plausible and detailed but were **not** verified here. They are QuickApp-authoring facts rather than MCP behaviours, and this codebase has now been bitten three times by promoting an untested claim into documentation. They are deliberately left out of tool descriptions and instructions until someone tests them.

## [4.14.0] - 2026-08-11

### Added
- **Server `instructions` at initialize.** MCP lets a server send a block of guidance that clients surface as session context. This server sent none, which left a real gap: a tool description is only read once someone has already reached for that tool, so nothing reaches the caller at the point they are deciding *how to approach a task at all*. That is where the expensive mistakes happen — a day was lost this month designing around an assumption that a tool description could never have corrected, because the tool was never opened.

  The bar for this text is deliberately higher than for a tool description: it is injected into every session and nobody can opt out. **Only facts verified against a live gateway** — nothing inherited, nothing merely documented, nothing reported-but-untested. That bar was earned. An earlier draft would have asserted that device icons are single-image sets and that every state change must be code-driven; both were false, taken from Fibaro's OpenAPI spec rather than from the wire, and would have been injected into every session until someone noticed.

  Nine lines: the 200-with-a-placeholder rule, the per-device-type icon set model, the 128×128 rule and the irrelevance of colour type, per-bucket icon name collisions, `get_scenes` overflow, the 501 endpoints, post-write verification, and the reminder that clients cache tool schemas at connect. Plus the four resource URIs.

### Changed
- **`create_backup` now says that it REBOOTS the gateway.** Its description was 19 characters and mentioned no such thing, so an agent asked to "take a backup first" would restart a live home-automation controller mid-flight without warning. Also records that remote backups fail *silently* once the cloud account is over quota — both create flags go false and nothing else indicates it, so a gateway can sit for months with no usable backup — and that backup payloads are encrypted, making restores all-or-nothing.
- `can_create_backup` and `get_remote_backup_status` carry the same warnings.

### Test harness
- **`scripts/test/unit-instructions.mjs`** guards the bar as much as the field: that the two disproven claims (single-image sets, palette requirement) cannot reappear, that no unverified claim is promoted into every session's context, and that the text stays within a sane budget.

## [4.13.1] - 2026-08-11

### Fixed
- **`upload_icon` no longer rejects RGBA PNGs.** It refused any PNG whose colour type was not 3 (palette), on an inherited claim that HC3 "silently 500s on RGB/RGBA". That claim is false, and the check rejected exactly the format the gateway itself uses: **every one of the 90+ user icons on a live HC3 is colour type 6 (RGBA)**. Verified by uploading one — HTTP 201, stored byte-identical, renders correctly.

  Found while trying to restore four room icons the user supplied: all three source files were 128×128 RGBA, and the tool would have refused all of them.

  The **128×128 check stays**, because that constraint is real and now quoted accurately: HC3 answers `400 INVALID_ICON_SIZE` for 64×64 and 256×256, rather than the silent-500 the old message described. Both were tested rather than assumed this time.

## [4.13.0] - 2026-08-11

### Fixed
- **Device icon sets, correctly modelled by device type.** 4.12.0 claimed device icons were single-image sets and that HC3 had no multi-state upload. **Both were wrong.** `POST /api/icons` accepts parts named `icon0` / `icon10` / … / `icon100`, which create `/assets/userIcons/devices/User<N>/User<N><state>.png` — one file per state, each carrying its own image. That form appears nowhere in HC3's spec (which lists only `icon`) but is what its own Web UI sends. The 4.12.0 conclusion came from reading the spec instead of testing the alternative.

  How many images a set holds is a property of the **device type**, verified by listing the files HC3 actually wrote and confirmed against what its UI offers:

  | deviceTemplate | Images | Pass |
  |---|---|---|
  | `com.fibaro.genericDevice` (QuickApp tile) | 1, stored bare | `base64` |
  | `com.fibaro.binarySwitch` (relay) | 2 — states 0, 100 | `states` |
  | `com.fibaro.multilevelSwitch` (dimmer) | 11 — states 0,10,…,100 | `states` |

  Where a set applies, **HC3 switches between the images itself from the device value** — on/off comes free with no code, which reverses 4.12.0's advice that every transition had to be driven from Lua.

  Getting the shape wrong is silent: a single bare image on a relay registers, attaches, reports no error, and renders **blank**, because the lookup asks for `User<N>0.png`. `upload_icon` now refuses the mismatches it can recognise — single image for a set type, states for a single-image type, and an incomplete set (a dimmer missing state 40) — and accepts unlisted types as given. Every state image is validated before any of them are written, so one bad frame fails the set rather than leaving it half-populated.

- **`get_icon` gains `state`**, and `upload_icons` carries the same per-variant `states` shape so a batch of variants stays one call.

### Test harness
- `unit-upload-icon.mjs` and `unit-upload-icons.mjs` extended for the state model: part naming and ascending order, the type-aware refusals, per-frame validation before any write, and that a QuickApp tile still takes a single image.

## [4.12.0] - 2026-08-11

### Added
- **`upload_icons` — batch upload for state-variant sets.** A device whose tile reflects state needs one image per variant, and doing that one call at a time is tedious and easy to lose track of. `upload_icons` takes a labelled array, wraps `upload_icon` per image so every guard and post-upload verify still applies, and returns a `labels` map plus a **ready-to-paste Lua table** of label → id — which is what you actually need in the QuickApp.

  Uploads run **sequentially**: HC3 assigns `User<N>` ids in order and concurrent posts risk interleaved assignment. Each upload is a committed write and HC3 has no transaction, so the batch is **not atomic** — `uploaded` and `failed` are reported separately, and the hint warns against re-running a partially-failed batch, which would duplicate the successes. All batch-level validation (duplicate labels, missing base64/mime, `deviceTemplate` for device) runs **before the first write**, so a 17-image batch missing `deviceTemplate` creates zero icons rather than sixteen and a stop.

  Labels that are not valid Lua identifiers are emitted in `["..."]` form so the table always parses.

### Changed
- **`upload_icon` description now states what device icons actually are.** HC3's stock library ships multi-state sets (`light0` / `light50` / `light100` — verified on the gateway as distinct files), which reasonably suggests an uploaded device icon should also be a set. It cannot be: `POST /api/icons` takes **one file and has no state parameter**, and HC3's own spec describes the result as "a new icon set". So a user device icon covers every state, and **HC3 will not switch images from device value** — every state change is code-driven.

  The description now says so, and records the verified mechanism: attach with `modify_device({deviceId, properties:{deviceIcon: id}})`, switch at runtime with `self:updateProperty("deviceIcon", id)`. Both confirmed live on 5.210.12 — a QuickApp set its icon at init and switched to a second icon five seconds later, with the property change observed from outside. `deviceIcon` is a real write, not one of HC3's silent-cache paths.

  Also recorded in the module header: HC3's spec at `/assets/docs/hc/icons.json` lists only `icon` and `type` as required and omits `deviceTemplate` entirely, so the gateway enforces more than it documents.

### Test harness
- **`scripts/test/unit-upload-icons.mjs`** — no-HC3 unit test covering the label→id map, Lua table emission including the bracket form for non-identifier labels, `luaTableName` and `luaTable: false`, per-image mime override, a partial failure keeping successes and naming failures with a retry-only-those hint, and that every batch-level validation fires before any POST (asserted by counting attempted uploads: zero). Wired into `npm test`.

## [4.11.0] - 2026-08-11

### Changed
- **`hc3://binder` cross-checks the cache against the declared descriptors.** A role sitting at `L5_missing` meant two entirely different things and the resource reported them in one undifferentiated list, which hid the real fault:
  - **descriptor present, nothing matched** — the physical device is gone and consumers have fallen through to their static defaults. *Action: re-include the device.*
  - **no descriptor at all** — nothing declares this role any more, so the binder will never revisit it. A leftover from a retired device. *Action: prune.*

  The resource now parses every `bind("RoleStem", { ... })` block from the binder QuickApp's own source and splits the two, each with its own instruction. It reuses `parseBindBlocks` from `audit.ts` (now exported) rather than growing a second Lua parser that could drift from the first. When the descriptors cannot be read it says so and declines to guess — no orphan count is shown at all, rather than a wrong one.

  Found in practice: of two `L5_missing` roles on a live gateway, one was a blind awaiting re-inclusion and the other was a cache entry orphaned three weeks earlier by a deliberate device deletion. Opposite responses, previously indistinguishable.

## [4.10.0] - 2026-08-11

### Added
- **MCP Resources — four read-only, at-a-glance views.** `resources/list` previously returned `[]` and the server declared only `tools: {}` in its capabilities, so the whole Resources surface was unbuilt. It now declares `resources: {}`, implements `resources/list` and `resources/read`, and serves four Markdown documents. Resources need no tool call and no arguments: a client lists them and the user reads one.

  - **`hc3://health`** — firmware and serial, fleet size, every dead/unreachable device named with room and type, battery outliers below 30%, disabled devices. The "is anything broken right now" view.
  - **`hc3://watchdog`** — every `*Heartbeat` global with its age against **HC3's own clock** and a fresh/stale verdict (stale after 10 minutes), plus the matching watchdog push markers. Heartbeats are discovered by name pattern, not hard-coded, so a QuickApp added later appears without a code change. A heartbeat whose value is not an epoch is reported as such rather than silently treated as fresh.
  - **`hc3://binder`** — the published `BinderBindings` map summarised, plus the resolver cache decoded: roles counted by resolution method, every role *not* at `L0_cached` listed with its id, recent heal history, and `BinderParamDrift` status. The cache is ~160 KB of JSON on a real system and was not readable without parsing it by hand.
  - **`hc3://globals`** — scalar globals with last-changed times, structured globals summarised by size and shape rather than dumped, and a real decode of `DeadDeviceWatch_State` (devices watched, currently flagged dead, failure counts). Heartbeats are excluded here since they have their own resource.

  **Security note:** QuickApp variable arrays can carry credentials — `deviceBinder` 4826 holds `HC3_USER` and `HC3_PASS` in the same array as its binding cache. The binder resource reads that one variable **by name** and never emits a `quickAppVariables` array. A unit test asserts no credential value or name reaches the rendered output; it is the check most worth keeping if this file is ever refactored.

  Every resource degrades honestly: a missing global, an unreadable cache or an empty gateway produces a document that says so, rather than a partial view that reads as "nothing wrong".

- **`scripts/dashboard.mjs` + `npm run dashboard`** — renders the four resources into one self-contained HTML page (inlined CSS, no external requests, light and dark). The resources are the source of truth and the page is a view over them, so it cannot drift from what the server reports; re-run to refresh, and the header stamps which snapshot you are looking at.

### Test harness
- **`scripts/test/unit-resources.mjs`** — no-HC3 unit test (faked client) covering the list shape, unknown-URI handling, dead/battery/disabled classification, the stale-heartbeat verdict and the not-an-epoch case, binder method counting and non-L0 listing, graceful degradation when the cache is unreadable, the globals scalar/structured split and dead-device decode, that every resource renders on an empty gateway, and the credential-leak assertions. Wired into `npm test`.

## [4.9.0] - 2026-08-11

### Added
- **`import_quickapp` is implemented.** It was a stub that threw unconditionally — *"QuickApp import requires file upload functionality that is not yet implemented. Use the Fibaro web interface for imports."* — for every call, with no code path that could ever contact HC3. The module header said so; the tool description did not, and 4.7.1's description (added from a bug report, on trust rather than verification) made it sound like a working tool with a server-side path. That was wrong and is corrected here.

  It now posts `multipart/form-data` to `POST /api/quickApp/import` with a `file` part and an optional `roomId` part, per the gateway's own OpenAPI document at `/assets/docs/hc/quickapp.json`. Same hand-rolled multipart as `upload_icon`, which is proven against this firmware.

  **`base64`** takes the .fqa content directly, so a client driving a remote server (the normal case for a tunnelled deployment) can import without shell access to the server host. **`filePath`** still works and is still resolved server-side — now stated plainly in the description, and the read error says which machine the path was resolved on. Exactly one of the two is required.

  The .fqa is JSON, so it is parsed and checked for `name`/`type` before posting: a truncated or mis-encoded payload produces a precise error instead of HC3's bare `Cannot import quick app file`. A 403 is annotated with the reason it usually happens — the .fqa was encrypted for a different gateway and cannot be imported anywhere but its origin controller. Success is verified by refetching the reported device id, matching the post-write verify pattern used across this module.

  Verified live against 5.210.12: a QuickApp was created, exported, re-imported via `base64` and again via `filePath`, both imports refetched and confirmed, and all three devices deleted and verified gone.

### Test harness
- **`scripts/test/unit-import-quickapp.mjs`** — no-HC3 unit test (stubs `fetch` to capture the multipart body) covering the endpoint and file part, `roomId` presence/absence and the `roomId: 0` falsy trap, the `fileName` override, the closing boundary, both mutual-exclusion refusals, the non-JSON and not-a-.fqa rejections happening before any POST, the server-side path error naming the host, HC3's `reason`/`message` surfacing, the 403 annotation, a 2xx with no device id, and the post-import verify. Wired into `npm test`.

## [4.8.0] - 2026-08-11

### Fixed
- **`get_icon` can fetch device icons.** Device icons resolved to `/assets/icon/fibaro/device/{name}.{ext}`, which does not exist. Probing the live gateway shows each device icon set is **its own directory holding one file per state** — `/assets/icon/fibaro/zraszacz/zraszacz0.png` — and that **`deviceType` is not part of the path at all**, contradicting the tool's own description. The path is now `{iconSetName}/{iconSetName}[state].{ext}`, with an optional `state` parameter; when omitted the unsuffixed file is tried first, then state 0 (both shapes exist in the wild — `light/light.png` and `light/light0.png` are different images).

- **`get_icon` no longer returns placeholders as success.** HC3 answers **HTTP 200 for missing assets**, in two shapes: a 1888-byte "unknown icon" SVG under `/assets/icon/fibaro`, and its ~13 KB web-UI `index.html` anywhere else. A deliberately bogus path returns 200 just like a real one, so status proves nothing. The previous placeholder guard only fired when the requested extension was `png`, so **every device SVG fetch appeared to succeed while returning the placeholder** — which is why a report of this bug listed device SVG as working. Both shapes are now rejected for any extension, and the error lists each candidate path with the reason it was rejected.

  Also corrects the user scene segment: built-in scene icons live under `scena`, user scene icons under `scenes`. A user scene icon never resolved before.

  Known gap, stated in the tool description rather than papered over: user-uploaded **device** icons are not served under any discoverable `/assets` path on 5.210.12. They work as `deviceIcon` ids but cannot be fetched back as files.

### Changed
- **`delete_icon` refuses to delete an icon that is still in use.** It previously deleted on the first call with no check; a user removed a live icon with it. The tool now scans for referencing objects (devices via `properties.deviceIcon`, rooms and scenes via their `icon` field) and refuses if any are found, naming them. The delete is immediate and the image bytes are unrecoverable, so this is a refusal rather than a warning. `force: true` overrides. A scan that **fails** also refuses rather than treating "could not check" as "not in use".

### Test harness
- **`scripts/test/unit-icon-paths.mjs`** — no-HC3 unit test (stubs `fetch` with a gateway that serves only known paths and returns the appropriate placeholder for everything else) covering device path construction, the unsuffixed-vs-state-0 order, explicit `state`, that `deviceType` and a bare `device` segment never appear in a URL, rejection of both placeholder shapes, the room/scene layouts including `scenes` vs `scena`, and all four `delete_icon` guard paths. Wired into `npm test`.

## [4.7.1] - 2026-08-11

### Fixed
- **`upload_icon` works for device icons.** Every `category: "device"` upload failed, whatever the payload — reported 11 Aug 2026 after four attempts (two SVG, two PNG, one of them meeting every documented constraint: 128×128, palette, colour type 3). The cause was not the image. HC3 files device icons **per device type**, so `POST /api/icons` requires a `deviceTemplate` part alongside `type` / `icon` / `fileExtension`; the tool never sent one and HC3 answered `400 MISSING_PARAMETER — deviceTemplate: missing required parameter`. Room and scene icons are not filed per type and must not carry the part, which is why only device uploads were affected.

  `upload_icon` now takes a **`deviceTemplate`** parameter (the Fibaro device type the icon is filed under, e.g. `com.fibaro.binarySwitch`). It is required for `category: "device"` and rejected for room/scene, both checked at the tool boundary before any HC3 contact so the caller gets an actionable message naming a concrete example rather than a bare gateway rejection. The room/scene multipart body is unchanged byte-for-byte — the new part is appended only when supplied.

  Verified live against HC3 5.210.12 with the exact 419-byte PNG from the report, and with SVG: both upload cleanly under `device` once `deviceTemplate` is supplied.

- **Upload failures are now diagnosable.** HC3 returns errors as `{type, reason, message}`. `upload_icon` parsed none of it, so a gateway rejection and a crash inside the handler were indistinguishable from the client side. The thrown error now leads with HC3's `reason` and `message` when the body is JSON, falls back to the raw body when it is not, and says `(empty body)` rather than trailing off into nothing.

### Changed
- **`upload_icon` returns a category-aware `hint`.** Device icons attach by **numeric id** via `modify_device({deviceId, properties:{deviceIcon: <newId>}})`, not by name — the old hint suggested the room/scene `fields:{icon: "User<N>"}` form for every category, which does not work for devices. The device result also echoes back `deviceTemplate`.
- **`upload_icon` description**: documents the `deviceTemplate` requirement, and confirms **SVG is genuinely supported** with no size or colour constraints. The two SVG attempts in the report failed for the deviceTemplate reason, not because SVG was unwired — worth stating, since the report reasonably suspected the latter.
- **`import_quickapp` description**: `filePath` is resolved **server-side**, on the host running the MCP server rather than the machine driving the client. This matters when the server is remote (a .fqa on the client's disk will not resolve); the description previously did not say which side the path belonged to.
- **`create_quickapp` `initialProperties` description**: notes that `uiCallbacks` passed at creation is not preserved — HC3 5.210.12 regenerates the callback table from the view, discarding named callbacks in favour of auto-generated `onReleased` handlers. The layout renders correctly and only the callbacks are wrong, so the loss is easy to miss; write them back with a follow-up `modify_device`.

### Test harness
- **`scripts/test/unit-upload-icon.mjs`** — a no-HC3 unit test (stubs `fetch` to capture the multipart body, injects a fake client for the before/after listings) covering: the `deviceTemplate` part is actually sent for device uploads and absent for room uploads; both guard rails refuse before any POST; the file part keeps its filename and content type and the body ends with a proper closing boundary; HC3's `reason`/`message`, a non-JSON body, and an empty body all reach the caller; the 128×128 and palette pre-checks still bite; SVG skips them; and the hint is category-aware. Wired into `npm test`.

## [4.7.0] - 2026-05-30

### Added
- **`get_scene` tool.** Read a single scene by id via `GET /api/scenes/{id}`, returning the full record — metadata plus the complete `content` (Lua source or scenario JSON). Scenes were the only major domain with a plural lister (`get_scenes`) but no singular getter (every other domain already has one: `get_device_info`, `get_room`, `get_quickapp`, `get_profile`, `get_climate_zone`, `get_sprinkler_system`, `get_custom_event`, `get_notification`, `get_icon`, `get_alarm_partition`). This mattered in practice: `get_scenes` returns *every* scene with its full content — observed at ~1.9 MB across 59 scenes (individual content bodies 100–143 KB) — which overflows response limits, so there was no workable way to inspect one scene. `get_scene` takes `sceneId` and an optional `includeContent` (default true); `includeContent=false` strips the large body and instead reports `contentOmitted: true` + `contentLength` for metadata-only queries. Unit test in `scripts/test/unit-get-scene.mjs`.

## [4.6.1] - 2026-05-30

### Fixed
- **`get_event_history` is now complete for busy retrospective windows.** 4.5.1 filtered the object-id set client-side but fetched only a single page; because HC3 caps `/api/events/history` at `numberOfRecords` **newest-first**, a target device's older in-window events were truncated before the filter ran — a query for a device that *did* have events in the window returned `[]` (reproduced live). When scoping to `object_id(s)` over a bounded window (`from` set), the tool now **pages backwards** through the window: it walks `to` down to the oldest event seen and refetches (deduping by event id across the boundary) until the whole window is covered, then applies the client-side id + time filters. A 20-page (~20k event) safety cap prevents runaway paging on pathologically dense windows; hitting it logs a stderr note rather than silently dropping the oldest slice. Unbounded set queries (no `from`) still take a single page — there is no floor to page down to.

## [4.6.0] - 2026-05-30

### Added
- **`get_hc3_time` tool.** Returns HC3's current wall-clock time (NTP-sourced) so the assistant can establish "now" instead of inferring it from event timestamps or the sometimes-stale MCP host clock. Sourced from `GET /api/settings/info` — uses `timestamp` (fresh epoch seconds) and `timezoneOffset` (seconds east of UTC, DST-aware); **never** `serverStatus`, which is a heartbeat that can read days stale (a code comment guards against re-wiring it). Returns `{ epoch, iso_utc, iso_local, weekday, weekday_short, local_pretty, timezone_offset_s, date_field_raw, source, warnings }`. The **weekday is computed once server-side** from `epoch + offset` and returned as an explicit string (`local_pretty` reuses it) — the consumer reads the day name directly rather than deriving it, which removes a recurring wrong-weekday error. A skew guard compares HC3's `timestamp` against the host's `Date.now()` and pushes a `warnings` entry (without failing) when they differ by more than ~120s. Unit test in `scripts/test/unit-hc3-time.mjs` covers the derived fields, the 25 Jul 2026 = Saturday spot-check, the skew warning, and that `serverStatus` is never used.

## [4.5.1] - 2026-05-30

### Fixed
- **`get_event_history` object-id filter now works without `object_type`.** 4.5.0 forwarded `objectId` server-side and fanned out one request per id, but live testing against the gateway showed HC3 **silently ignores `objectId` unless `objectType` is also supplied** — so `object_ids` (or `object_id`) on its own returned the full feed, unfiltered. The object-id filter is now enforced **client-side** against each event's `objects[].id` (the source of truth), so it works regardless of `object_type` and for an arbitrary set of ids. The fan-out is dropped in favour of a single fetch that pulls a generous page (1000) when a set is requested, then filters and trims to `limit`. `from`/`to` remain forwarded server-side (confirmed working on the live gateway). When a single `object_id` **and** `object_type` are given, HC3 is still asked to narrow server-side (lets it page back through history for a quiet device). This was caught by re-running the original repro against the live HC3 after 4.5.0 deployed.

## [4.5.0] - 2026-05-30

### Fixed
- **`get_event_history` now honours time-window and multi-device filters.** Previously the only time filter was `since_timestamp`, applied *client-side after* HC3 had already returned the most-recent-N events — so a retrospective window ("what fired between 06:00 and 10:00 this morning?") could never reach back past the last N events; you just got the recent handful, then filtered. And device scoping was limited to a single `object_id`; there was no way to query a set of zones. Both gaps are closed:
  - **`from` / `to` (Unix epoch seconds)** are now forwarded to HC3's `/api/events/history` server-side (`from=` / `to=`), so a bounded window reaches arbitrarily far back rather than only the most recent events. The endpoint honours these natively (verified against the live HC3; the prior "HC3 silently ignores server-side time params" note was incorrect). A client-side time filter is kept as an exact backstop.
  - **`object_ids` (array)** scopes the query to a set of devices/scenes. HC3's native endpoint filters one `objectId` per call, so a multi-id query fans out one request per id (each still time-bounded by `from`/`to`), then merges + dedupes by event id and re-sorts newest-first. The scalar `object_id` still works and is merged in if both are supplied.
  - **`since_timestamp`** is retained as a deprecated alias for `from` (lower bound). Existing callers keep working — and, as a side effect, now actually reach back in time, since the bound is forwarded server-side instead of only trimming the recent-N page.

### Test harness
- **`scripts/test/unit-event-history-filters.mjs`** — a no-HC3 unit test (injects a fake client that records request URLs) asserting `from`/`to`/`object_id`/`object_ids` are actually forwarded onto `/api/events/history`, that the multi-id fan-out dedupes and stays newest-first, and that `since_timestamp` still bounds the lower edge. Wired into `npm test`.

## [4.4.0] - 2026-05-25

### Added
- **`create_quickapp_variable` tool.** Add a new QuickApp variable without a UI round-trip. Read-modify-write against `PUT /api/devices/{id}` with `properties.quickAppVariables`: reads the full array, appends the new entry, writes back, refetches, and verifies name / value / type all match the intended state. Refuses if the name already exists (points caller at `set_quickapp_variable`). Optional `varType` lets the caller declare the stored HC3 type; if omitted, it's inferred from the JS type of `value` — `boolean` → `'bool'`, `number` → `'number'` (never `'integer'` by inference; opt in explicitly), `string` → `'string'`.

- **`delete_quickapp_variable` tool.** Remove a QuickApp variable by name. Same full-array-replace pattern (read, filter out, write back, verify absent). Refuses if the name doesn't exist — typo / already-deleted protection. Returns the deleted entry's previous `{type, value}` as a recovery trail.

  Together with the existing `get_quickapp_variable` / `set_quickapp_variable`, the QA-variable surface now mirrors the established `get / set / create / delete` shape used for global variables.

### Changed
- **`set_quickapp_variable` error message** on missing variable now points at `create_quickapp_variable` instead of "create new variables via the HC3 UI". Description string updated to match.

### Test harness
- **Phase 2 section [6]** (QA variable lifecycle) was previously a documented skip — *"no API path to create a QA variable; needs UI-bootstrapped fixture"*. That gap closes with this release. The section is now a real create → set → get → delete cycle on the ephemeral test QA from section [5], plus three negative cases (set-on-missing, create-on-existing, delete-on-missing).

## [4.3.0] - 2026-05-09

### Added
- **`delete_scene` tool.** Wraps `DELETE /api/scenes/{id}` with read-first-for-recovery-trail, refusal of `isRunning=true` scenes, and post-delete refetch verify (expects 404). Fills the long-standing gap flagged in `CLAUDE.md` and `scripts/test/README.md` — the test harness's `deleteSceneDirect()` raw-REST workaround can now be migrated to use the proper tool.

- **`set_device_parameter` tool.** The working REST path for Z-Wave configuration parameter writes on HC3 firmware 5.x. Wraps `POST /api/devices/{id}/action/setConfiguration` with body `{args:[parameterNumber, size, value]}`. Bypasses `control_device`'s actions-array pre-check for `setConfiguration` specifically (most Z-Wave devices don't declare it in their actions table — that guard is the right default for unknown action names but blocks this well-attested use case).

  The documented `setParameter` and `reconfigure` action endpoints, and the dedicated `pollConfigurationParameter`, return `{"error":{"code":-3,"message":"not implemented"}}` on firmware 5.x. The PUT `/api/devices/{id}` `{properties:{parameters:[...]}}` path silently caches without transmitting (S14 — `modify_device` rejects this for the same reason). `setConfiguration` is the only working channel.

  The tool reads-before, writes via the action POST, polls with backoff (500/1000/2000 ms cap) for the cache to reflect the new value, and returns `{before, after, cacheUpdated, actionResponse, transmissionNote}`. Mesh transmission to the physical device is not programmatically verifiable on HC3 5.x (no read-back path); the docstring is explicit about this. Empirically, transmission was confirmed on 2026-05-09 against a Fibaro FGD212 (auto-off param 10 — the device autonomously switched off after the configured delay, with no `turnOff` from the controller).

- **`get_server_info` tool.** Returns the server's name, version (read from `package.json` at startup so it stays in sync with the shipped tarball), transport (`stdio` or `http`), and configured `hc3Host`/`hc3Port`. No HC3 round-trip; reports local server state only. Useful for "which version of the MCP am I connected to" and "which HC3 is this MCP wired to" questions without inspecting the initialize handshake.

### Changed
- **Server version is now read from `package.json` at startup** (`src/mcp/version.ts`) and used in both the MCP `initialize` handshake's `serverInfo.version` and the new `get_server_info` tool. Removes the previously hard-coded `'4.2.2'` literal that drifted out of sync with releases.

## [4.2.2] - 2026-05-03

### Changed
- **Documentation sweep** to reflect the 11-release run from 3.4.1 through 4.2.1.
  - `README.md`: tool count bumped from "125+" to "130+" everywhere; new **Audit (cross-cutting, dev-time)** section in the tool list documenting `audit_id_references`, `audit_qa_devices`, `introspect_device_group`; new **Migrating from 3.x to 4.x** section calling out the QA file-arg rename (`name` → `fileName` for `create_quickapp_file` and `update_multiple_quickapp_files`); audit family added to the "How this differs from upstream" bullet list; `create_quickapp_file` description annotated with the rename; module count bumped from 23 to 24.
  - `package.json` `description`: bumped tool count, added "audit family for cross-surface drift detection", bumped module count from 23 to 24.
  - `SECURITY.md`: npm-tarball contents list now includes `KNOWN_DEAD_ENDPOINTS.md`.
  - `CHANGELOG.md`: this entry.

No code changes; live tool count remains 132 (the "130+" figure rounds down for headline simplicity).

## [4.2.1] - 2026-05-03

### Added
- **`introspect_device_group` bind-lua and yaml output formats.** `outputFormat: "bind-lua"` returns a ready-to-paste Lua `bind("RoleStem", { ... })` descriptor block matching the SceneManager bind() pattern (the role stem is the groupPath with any leading `Devices.` stripped). `outputFormat: "yaml"` returns a YAML document mirroring the json shape.

  bind-lua output: pretty-aligned field names, escaped Lua string values (handles `"` and `\\`), and a `lockNameForControllers` toggle (default `true`) which sets `lockName = true` on entries whose type matches `*FGRGBW442CC` — RGBW master controllers' names must not drift, or downstream channels lose their controller reference. Surfaces warnings on the response for FGRGBW442CC entries that were locked, and for any name containing `&`, `"`, or `\\` (special-character escaping warning so the operator double-checks the Lua paste).

  yaml output: hand-emitted (no library dependency), quotes any string that contains a YAML-special character, omits absent fields rather than emitting `null` keys.

  Both formats now complete the spec's full set of four outputs: `json`, `markdown-table`, `bind-lua`, `yaml`. Stateless; does not modify HC3 or local files.

## [4.2.0] - 2026-05-03

### Added
- **`audit_qa_devices` bind-aware mode.** Opt-in via `bindAware: true`. Parses every `bind("RoleStem", { ... })` descriptor in the QA's source files and runs the L0-L4 resolver waterfall over each role entry:
  - **L0** — cached: descriptor's `id` is still valid AND lives under the descriptor's `parent.id`, has the descriptor's `ep` and `type`. (`ok_l0`)
  - **L1** — endpoint: a sibling under the cached parent has the matching `ep + type`. The descriptor's cached id is stale; the role moved (typically a Z-Wave Reconfigure renumbered children). (`healed_l1_l3`)
  - **L2** — nameInParent: a sibling under the cached parent has the matching `name + type`. (`healed_l1_l3`)
  - **L3** — newParentEndpoint: re-resolve the parent by `name + type`, then look for the entry by `ep + type` under the new parent. Covers physical replacement when names are preserved. (`healed_l1_l3`)
  - **L4** — globalName: only when the descriptor opts in via `allowGlobal = true`. Matches `name + type` globally; if multiple candidates, AMBIGUOUS rather than picked. (`healed_l4` or `ambiguous`)
  - **L5** — missing: nothing matched.

  Type equality required at every level; ambiguity (>1 candidate) at any level returns no match rather than picking the first. Output adds a `bindAware` block: `{ enabled, summary: {descriptorTotal, ok_l0, healed_l1_l3, healed_l4, missing, ambiguous, warnings}, descriptorIssues, warnings }`. Issues are reported per role+field for every non-L0 outcome with the previous cached id and the resolved id (where one exists).

- **Sanity warning — "would be unsafe to enable allowGlobal"**: even with `allowGlobal = false`, the audit checks whether a global name+type match would have been ambiguous. If yes, surfaces as a warning so the operator knows that enabling allowGlobal on this descriptor is unsafe today. (Same shape as the spec called out.)

- **`strict: true`** option: treat `healed_l4` and any warnings as failures, surfaced in `summary.strictFailures`. Default false (informational).

### Changed
- Single all-devices fetch (`/api/devices`) per call, indexed in-memory by id and parentId for O(1) sibling lookups. Avoids hammering HC3 with one fetch per role entry on a large QA.

## [4.1.0] - 2026-05-02

### Added
- **`introspect_device_group`** — take a numeric `Devices.X.Y = { foo = 1234, bar = 5678 }` group inside a QA file and return a structured snapshot of the live state behind each id (name, type, parentId, endPointId from `/api/devices/{id}`). Auto-detects whether the group is endpoint-mode (all entries share a common parentId; each entry is a channel of one physical device, ep numbers captured) or flat (independent devices). Output formats: `json` (canonical, default) and `markdown-table` (h2 heading, parent line if endpoint mode, markdown table of entries — directly pasteable into a doc). Stateless; does not modify HC3 or local files.

  Lua-source navigation: brace-balanced search for the leaf table-key in the dotted path. Tolerates trailing commas, end-of-line comments, whitespace; nested-table or computed-expression entries surface as `parseErrors` rather than failing the whole call. Limitation: shadowed leaf names (multiple `<name> = {` blocks in the file) resolve to the first match — pass a more specific path if disambiguation matters.

  Lives in the existing `src/mcp/tools/audit.ts` module alongside `audit_id_references` (3.5.0) and `audit_qa_devices` (3.6.0). Future patch will add `bind-lua` and `yaml` output formats.

## [4.0.0] - 2026-05-02

### BREAKING
- **QuickApp file-arg renamed to `fileName` everywhere.** Two tools previously used `name` for the QA-source-file argument while three others used `fileName`. The half-and-half was a confusing footgun for callers — every MCP client (and every test harness) had to special-case which tool wanted which key. The Phase 2 test sweep failed 3 of 5 round-trip steps on its first run for exactly this reason.

  Renamed (was `name` → now `fileName`):
  - `create_quickapp_file` — top-level `name` arg → `fileName`
  - `update_multiple_quickapp_files` — per-item `name` field → `fileName`

  Unchanged (already used `fileName`):
  - `update_quickapp_file`, `delete_quickapp_file`, `get_quickapp_file`

  HC3's own wire shape still uses `name` for the file's own name in the request body to `/api/quickApp/{id}/files`; the wrapper now remaps `fileName` → `name` on the way out (callers don't see HC3's wire form).

  No backward-compat shim — `name` is dropped immediately rather than carried through a deprecation cycle, hence the major-version bump. Migration: rename `name` → `fileName` in any call to `create_quickapp_file` or in any file element passed to `update_multiple_quickapp_files`. The other QA-file tools were already using `fileName` and need no change.

  Why the breaking-change-now choice: the duplicate-arg-name pain was concrete (test fixtures, this MCP's own callers, every LLM) and the consumer base small enough that a clean cut is cheaper than a deprecation cycle. Future schema-name additions across the MCP follow this rule: pick the form that names the *thing* (`fileName`, `varName`, `deviceId`) rather than the bare overloaded `name`, and apply consistently.

### Changed
- Tool descriptions and schema `required` arrays for the two affected tools were updated to match the new arg name.

## [3.6.2] - 2026-05-02

### Fixed
- **`get_alarm_partition` calls a 404 endpoint.** The bare-id endpoint `GET /api/alarms/v1/partitions/{id}` returns HTTP 404 on current firmware (5.20x), even when the id exists in the list returned by `/api/alarms/v1/partitions`. Same dead-endpoint pattern as `/api/energy/{id}` (fixed 3.4.1) and `/api/quickApp/{id}` (fixed 3.5.1). Surfaced by Phase 6 of the read-only test sweep.

  The wrapper now fetches the full partition list via `/api/alarms/v1/partitions` and filters in-process. Throws a precise error if the requested id isn't present, pointing the caller at `get_alarm_partitions` to enumerate available partitions.

### Changed
- **`KNOWN_DEAD_ENDPOINTS.md` restructured into two categories** — *permanent* and *STARTING_SERVICES-conditional* — to distinguish endpoint families that have been removed from firmware (no realistic prospect of return; route around) from endpoints that depend on HC3's panel-services cluster (can come back to life across firmware upgrades or controller reboots; tools should fail clean rather than silently empty). Added the new `/api/alarms/v1/partitions/{id}` entry under the permanent category.

## [3.6.1] - 2026-05-02

### Fixed
- **`create_global_variable` no longer propagates HC3's raw "deserializeJson error: types mismatch" for numeric / boolean values.** HC3 stores all global-variable values as strings; submitting JSON `0`, `true`, etc. caused HC3 to reject the POST with a confusing 400. The wrapper now coerces numeric and boolean values to their string forms before submission, matching the schema's own `["string", "number", "boolean"]` advertisement. Throws a precise error if the value isn't string/number/boolean (instead of letting HC3's opaque error bubble up).

  Surfaced by the Phase 3 edge-case test: `create_global_variable({varName: "TEST_x", value: 0})` previously failed with HC3's raw deserialise error; now succeeds and stores `"0"`.

- **`set_global_variable` is now defensive against the same "types mismatch" rejection** for any code path where the type-aware coerce branch produced a non-string `coerced` value (e.g. boolean true on a stored-as-boolean variable). The PUT body now always carries a string `value`. No behaviour change for the common case where the stored type is string; the fix is insurance against future stored-type drift.

## [3.6.0] - 2026-05-02

### Added
- **`audit_qa_devices`** — bind-agnostic core. For a given QuickApp, parses every numeric device id its source files reference and classifies each against live HC3 state. Universal HC3 question: *"after that recent Z-Wave re-inclusion (or device deletion), is this QA still pointing at real, alive devices?"*

  Walks every file in the QA, extracts every `\b\d{2,5}\b` numeric token (skipping master device 1, never user-referenced this way), and classifies each unique id via `/api/devices/{id}`:
  - **ALIVE** — exists, not deleted, not dead.
  - **DEAD** — exists with `dead == true`.
  - **DELETED** — `/api/devices/{id}` returns 404, or `deleted == true`.

  Issues are grouped by id with all source occurrences (file, line, snippet) attached, sorted DEAD-first then DELETED, then by id ascending. ALIVE refs are summarised in the stats but not enumerated. False positives — coincidental numeric matches that resolve to unrelated alive devices — are limited because the resolver only flags DEAD/DELETED ids; ALIVE matches mostly stay invisible.

  Inputs: `deviceId` (required, must be a QuickApp — interfaces must include `'quickApp'`); `fileNames` (optional array — scan a subset of files instead of all). Stateless audit; does not modify HC3 or local files. Cost: one `/api/devices/{id}` per unique candidate id, plus one fetch per file. Expect 10-30s on a typical QA.

  Verified live against HC3 5.203.68 with the SceneManager QA (id 4742, 19 files, 9,065 lines): 252 candidate ids extracted, 227 ALIVE, 4 DEAD (hob lights / blind / window SW / Ben bed walli — all flagged via `properties.dead === true`), plus 21 DELETED including the legitimate replaced-device residue (RGBW devices 3076-3080, brick relays 4702-4703) alongside ~14 well-known false-positives that mostly trace back to SceneManager-style noise patterns (table-of-trigger-id rows like `triggers = {901, 902}`, reserved-trigger constants in `manualTrigger(..., 999, ...)`, and reserved-trigger range markers in READ-ME).

  Important implementation note: HC3 records `dead` and `deleted` flags at `properties.dead` / `properties.deleted` rather than at the top level (top-level `dev.dead` is usually null even when the device is dead). The classifier checks both locations to be defensive across firmware revisions.

  Future bind-aware mode will additionally parse `bind("RoleStem", { ... })` descriptors and run the L0–L4 resolver waterfall — kept out of the v1 core to land the universally-useful piece first.

## [3.5.2] - 2026-05-02

### Added
- **`KNOWN_DEAD_ENDPOINTS.md`** — top-level catalogue of HC3 REST endpoints that don't behave as their name (or the legacy Swagger documentation) suggests on current firmware (5.20x). Captures the eleven dead/misleading endpoints surfaced by recent fixes (`/api/energy`, `/api/energy/{id}`, `/api/quickApp/`, `/api/quickApp/{id}`, `/api/info`, `/api/firmware`, `/api/firmware/v1/status`, `/api/eventsHistory`, `/api/panels/event`, `/api/diagnostics/*`, `/api/zwave/*`) plus the two misleading-200 endpoints (`/api/energy/devices/{id}/summary` and `.../history`, both silently return the bare device list ignoring the trailing path and query parameters). Each entry has a curl reproduction, observed behaviour, and the working alternative.

  Cross-linked from `README.md` (Known issues section), `SECURITY.md` (out-of-scope clause), and shipped in the npm tarball via the `files` whitelist so users running `npm install -g` get the document alongside the binary.

  Maintainers should append new entries as they are discovered. Any future tool author can read this once and avoid an hour of probing the same dead paths.

## [3.5.1] - 2026-05-02

### Fixed
- **`get_quickapps` and `get_quickapp` repaired.** Both tools called endpoints that return HTTP 501 on current firmware (5.20x): `GET /api/quickApp/` for the list, `GET /api/quickApp/{id}` for a single QA. Aside-discovered while building `audit_id_references` (3.5.0) — the same dead-endpoint pattern as the `get_energy_data` regression fixed in 3.4.1.

  Replacements use the canonical `/api/devices` family which works on current firmware:
  - `get_quickapps` → `GET /api/devices?interface=quickApp` returns the same QA list (filtered to devices whose `interfaces` array contains `"quickApp"`).
  - `get_quickapp` → `GET /api/devices/{id}` plus a sanity check that the returned device's `interfaces` includes `"quickApp"`. If the id resolves to a non-QA device, the tool throws a precise error pointing at `get_device_info` for non-QA records — better than the original endpoint which would have errored without explanation.

  The `/api/quickApp/{id}/files...` family (file CRUD) still works on current firmware and is untouched. Only the bare-id forms are dead.

### Notes
- Kept the dead-endpoint catalogue growing: the count is now 8 confirmed dead endpoints (`/api/energy`, `/api/energy/{id}`, `/api/quickApp/`, `/api/quickApp/{id}`, `/api/info`, `/api/firmware`, `/api/firmware/v1/status`, `/api/eventsHistory`, `/api/panels/event`). The forthcoming `docs/known-dead-endpoints` patch will document them all in one place.

## [3.5.0] - 2026-05-02

### Added
- **`audit_id_references`** — find every place a device id is referenced across the entire HC3 controller. Walks every QuickApp source file, every Lua/scenario scene's actions and conditions, every JSON (block-editor) scene's nested action tree, and every global variable's stored value. Returns a structured list of hits with the source surface, line number (where applicable), and a 120-char snippet centred on the match.

  Universal HC3 question: *"if I delete or replace this device, what breaks?"* Inputs: `deviceId` or `name` (resolves to one or more ids), optional `includeChildren` (default `true` — also audits child devices of a parent), optional `includeComments` (default `false` — by default skips Lua comment lines). Whole-word regex matching (`\b<id>\b`) so `2494` doesn't match `24941`.

  Cost-aware: each call fetches every QA file + scene + global on the controller; expect 30-90s on a typical install. Hard cap of 5 MB total content scanned; beyond that, response carries `truncated: true` plus a partial result. Stateless — does not mutate HC3 or local files.

  Lives in the new `src/mcp/tools/audit.ts` module. Future audit-family tools (`audit_qa_devices`, etc.) will be added to the same module.

## [3.4.1] - 2026-05-02

### Fixed
- **`get_energy_data` repaired.** The tool was calling two endpoints that have been dead on HC3 firmware 5.20x (and likely much earlier): `GET /api/energy` returned HTTP 500 with empty body, and `GET /api/energy/{id}` returned HTTP 400 `path: 9 arguments` (the latter expects a legacy 9-segment path of the form `/api/energy/{deviceId}/{measure}/{interval}/{y1}/{m1}/{d1}/{y2}/{m2}/{d2}` which is no longer routed). Surfaced by the Phase 1 read-only test sweep; would have stayed latent indefinitely otherwise — `get_energy_data` had been silently broken since at least firmware 5.200.

  The new behaviour calls only endpoints that actually work on current firmware:
  - **No-args** → returns `{ summary, meterDevices }` where `summary` comes from `/api/energy/billing/summary` (system-wide current-billing-period totals — production / consumption / cost) and `meterDevices` comes from `/api/energy/devices` (the list of energy-metering devices, useful as a discovery hint for follow-up `deviceId` queries).
  - **With `deviceId`** → returns the device's energy-meter registration row from `/api/energy/devices` if the device is metered, or a precise error distinguishing "device exists but isn't an energy meter" from "device id not found on this HC3" otherwise.

  Per-device historical energy data is **not exposed by REST** on current firmware. The energy panel UI uses internal services that aren't accessible via the REST API; the legacy 9-segment path is permanently dead. The tool's description now states this explicitly so callers (LLM or human) don't waste time trying.

### Breaking
- **`get_energy_data` no-args response shape changed** from a (broken) bare object to `{ summary, meterDevices }`. Since the old behaviour returned HTTP 500, no callers can have been relying on the old shape — but if your LLM has the old shape in its training data, this is the migration. See the `Fixed` entry above for the new shape.

## [3.4.0] - 2026-05-02

### Changed (internal — no behaviour change)
- **Modularised `src/mcp/hc3-mcp-server.ts`.** The single 7,330-line class that owned every transport, schema, dispatch arm, and handler was split into a 244-line orchestrator plus 23 per-domain tool modules under `src/mcp/tools/`, with shared helpers in `src/mcp/util.ts` (`deepEqual` / `deepMerge` / `verifyWrite` / `tolerantFetch`), the MCP envelope types in `src/mcp/types.ts`, the HC3 REST client in `src/mcp/hc3-client.ts`, and the two transports in `src/mcp/transport/{stdio,http}.ts`. The four HC3 documentation/programming guides moved earlier (3.3.x development) to `src/mcp/docs/*` and now feed `src/mcp/tools/docs.ts`.

  Every commit in the 12-step series was byte-preserving: `tools/list` JSON output and the four `get_hc3_*_guide` tool responses are sha256-identical to 3.3.1 across all 39 documented test cases. Every guard message (control_device's setVariable rejection, modify_device's quickAppVariables/parameters/associations rejection, delete_device's Z-Wave/cascade/<10 guards, set_quickapp_variable type coercion + verify, delete_plugin bulk guard, set_home_status mode whitelist, update_user_rights privilege-escalation guard, etc.) was live-checked at every PR boundary.

  New patterns introduced:
  - **Tool registry** (`src/mcp/tools/registry.ts`): each domain module exports `{schemas, handlers}`. `mergeHandlers` collects them at boot. `handleCallTool` is a 4-line direct dispatch with an explicit `Unknown tool` throw — the legacy ~125-arm switch is gone.
  - **Named-record schemas** (`<module>Schemas: Record<string, MCPTool>`) for domains whose tools are non-contiguous in the legacy `tools/list` ordering (system/zwave interleave; the deletes cluster at the tail; user tools sandwiched around globals). Each schema is referenced by name at its exact slot to preserve byte-identical ordering.
  - **Snapshot scripts** (`scripts/snapshot-doc-tools.mjs`, `scripts/snapshot-tools-list.mjs`) committed in the first PR as durable regression checks. The same `ddf8f9c5…` and `6342a6a4…` SHAs hold across all 12 PRs.

### Fixed
- **`get_zwave_node_diagnostics` arg name mismatch (pre-existing).** The tool's input schema declared `min_outgoing_failed_percent` and `sort_by` (snake_case), but the legacy in-class method took camelCase positional arguments — with the dispatch case arm doing the snake→positional mapping. The new module handler reads snake_case directly from `args`. Behaviour from a caller's perspective is identical (the schema was always the wire contract); the bug was that the legacy method's parameter names didn't match the schema's field names, which would have surfaced if anyone hand-rolled a different dispatch path. Fixed in PR #10 of the modularisation series and verified live.

### Final layout
```
src/mcp/
├── hc3-mcp-server.ts        244 lines  (was 7,330 — 97% reduction)
├── types.ts                  31
├── hc3-client.ts             89
├── util.ts                  126
├── transport/{stdio,http}.ts
├── docs/{configuration,quickapp-programming,lua-scenes,programming-examples}.ts
└── tools/                    23 modules covering all 129 tools
    ├── registry.ts
    ├── alarm.ts        backups.ts      climate.ts       customEvents.ts
    ├── debug.ts        devices.ts      docs.ts          globals.ts
    ├── icons.ts        intelligence.ts ios.ts           notifications.ts
    ├── plugins.ts      profiles.ts     quickapps.ts     rooms.ts
    ├── scenes.ts       snapshot.ts     sprinklers.ts    system.ts
    └── users.ts        zwave.ts
```

## [3.3.1] - 2026-04-27

### Fixed
- `serverInfo.version` in the MCP `initialize` response now reflects the package version. It was hard-coded to `'0.1.0'` when the standalone fork landed in 3.0.0 and never updated, so every connecting MCP client was being told the wrong version of the server it was talking to.
- `.env.example` keys corrected from the unused `HC3_URL` / `HC3_USER` / `HC3_PASSWORD` / `HC3_PORT` to the `FIBARO_*` names the code actually reads. Anyone copying the example file to `.env` got a server that couldn't reach HC3 — variables were silently undefined.
- `claude-config-example.json` replaced the original upstream maintainer's hard-coded local development path with the canonical `npx @northernrough/hc3-mcp-server` invocation already documented in README.
- `package-lock.json` version field synced with `package.json` (had drifted to `3.0.0` since the standalone fork; bumped via `npm version patch`).
- README accuracy sweep: `Available Tools (121+)` header corrected to `(125+)` to match the actual tool count and the neighbouring `125+` claims; mangled `<>=16-char secret>` token-length hint fixed; `DEPLOYMENT.md` added to the published-tarball file list (it was already in `package.json` `files[]`).

### Changed
- README's "External auth boundary" section expanded to spell out which Claude surfaces actually need `MCP_HTTP_ALLOW_UNAUTH=true` (claude.ai web/mobile custom connectors only) versus which can use bearer auth via header (Claude Code with HTTP transport via `claude mcp add --transport http --header ...`). Earlier wording named only "claude.ai custom connector" and risked confusing readers wiring up Claude Code's HTTP transport.
- `DEPLOYMENT.md` reorganised: git-clone install is now the recommended Pi deployment path, with `npm install -g` demoted to a brief alternative. Decouples Pi upgrades from npm publish cadence — upgrade flow becomes `git pull && npm ci && npm run compile && systemctl restart hc3-mcp`. The published npm package itself is unchanged and remains the right path for users who prefer a binary install.

### Added
- `scripts/pi-update.sh` — one-command wrapper for the git-clone Pi upgrade flow with a brief `journalctl` tail to confirm the startup banner. Mode `100755` in git, no `chmod` needed after clone. Not shipped in the npm tarball (it's only useful from a working tree).

## [3.3.0] - 2026-04-26

### Added
- **`MCP_HTTP_ALLOW_UNAUTH=true`** — opt-in flag that lets the HTTP transport start without `MCP_HTTP_TOKEN`, accepting requests on `/mcp` without any bearer check. Intended only for deployments where identity is enforced by an external layer (Cloudflare Access, reverse proxy auth, firewall rules). When the flag is set, the server emits a loud `WARNING: HTTP transport running WITHOUT bearer authentication …` line on startup and the readiness banner reads `NO AUTH — external auth layer required` instead of `bearer auth required`.

  Motivation: claude.ai's "Add custom connector" flow only supports OAuth 2.1 with Dynamic Client Registration; it cannot send a static `Authorization: Bearer …` header. Without this flag, the bearer wall blocked the most widely used remote MCP client. The fix preserves defence-in-depth for other clients (the bearer path is unchanged when `MCP_HTTP_TOKEN` is set) while letting Cloudflare Access become the sole identity layer for claude.ai.

### Changed
- HTTP startup validation: when `MCP_TRANSPORT=http` and `MCP_HTTP_TOKEN` is missing, the error message now points users at `MCP_HTTP_ALLOW_UNAUTH=true` rather than just refusing. Both flags must be deliberate — with neither set, behaviour matches 3.2.x (refuse to start).
- `DEPLOYMENT.md` rewritten end-to-end against a real Pi 5 deployment that exercised the full path. Adds: nano auto-indent trap (causes silent systemd parse failures), `127.0.0.1` vs `localhost` in cloudflared `config.yml` (cloudflared resolves `localhost` to `::1` on some hosts which IPv4-only Node servers refuse), `MemoryDenyWriteExecute=true` aarch64 V8 caveat (kills Node with SIGTRAP on Pi 5), `MCP_HTTP_ALLOW_UNAUTH=true` + Cloudflare Access section as the recommended path for claude.ai connectors.
- `README.md`: new "External auth boundary" subsection documenting the new flag, with security caveats and a pointer to `DEPLOYMENT.md`.

### Security
- Token-protected behaviour unchanged for existing users. No breaking change.
- The new flag is opt-in and noisy. The startup warning makes the security boundary explicit. Not setting it preserves the 3.2.x posture of refusing to start without a token.

## [3.2.1] - 2026-04-21

### Added
- **`DEPLOYMENT.md`** — step-by-step guide for running the server as a long-lived service on a Raspberry Pi 5 (or any Linux host) and exposing it to Claude on the web/mobile via a Cloudflare Tunnel + Cloudflare Access. Covers: dedicated unprivileged user, `/etc/hc3-mcp/.env` with `0640` perms, hardened systemd unit, named tunnel + DNS route, service-token-protected Access policy, and adding the endpoint as a custom connector at claude.ai. Plus ops procedures (logs, restart, token rotation, upgrades) and a troubleshooting matrix.
- **Startup smoke test for HTTP transport** — once `server.listen` reports ready, the server makes a one-shot `GET /api/settings/info` call and logs either `HC3 reachable at <host>:<port> — softVersion <v>, serial <sn>` or `HC3 reachability check FAILED: <reason>`. A misconfigured `.env` now shows up in `journalctl` immediately at boot rather than only on first user request. Stdio transport is unchanged.

### Changed
- `package.json` `files` whitelist now includes `DEPLOYMENT.md` so the guide ships with the npm tarball.

## [3.2.0] - 2026-04-26

### Added
- **HTTP transport** — opt-in via `MCP_TRANSPORT=http`. Default behaviour unchanged: stdio remains the transport for local Claude Desktop / Claude Code use, byte-for-byte identical to 3.1.1. The HTTP path enables running the server on an always-on host (Pi 5, server, container) reachable from Anthropic's cloud via a Cloudflare Tunnel for use from Claude mobile.

  - `POST /mcp` — JSON-RPC envelope in, JSON-RPC envelope out. Notifications (no `id`) return `202 Accepted` with empty body.
  - `GET /mcp` — SSE stream stub for server-initiated messages and notifications. Currently emits keep-alive comments only.
  - `GET /healthz` — unauthenticated readiness probe (200 "ok").
  - Bearer-token auth via `Authorization: Bearer <token>`. Constant-time comparison. Token comes from `MCP_HTTP_TOKEN`. Server refuses to start if the token is missing or shorter than 16 characters.
  - 1 MB request body cap. Request logging to stderr includes the JSON-RPC method name but never the arguments (which can contain credentials).
  - Pure `node:http`, no new runtime dependencies.

  New env vars: `MCP_TRANSPORT` (`stdio` default | `http`), `MCP_HTTP_HOST` (default `127.0.0.1`), `MCP_HTTP_PORT` (default `3000`), `MCP_HTTP_TOKEN` (required for HTTP).

### Changed
- Internal refactor: `handleMessage` now returns `MCPResponse | null` instead of side-effecting on stdout. Both transports call into the same dispatcher. Behaviour-preserving — verified by capturing stdio responses before the refactor and byte-diffing after; zero difference.

## [3.1.1] - 2026-04-26

### Added
- `upload_icon` — completes the icon CRUD set (deferred from 3.1.0). Wraps `POST /api/icons` with manual multipart/form-data construction (`type`, `icon`, `fileExtension`). HC3 ignores caller filenames and auto-assigns `User<N>` names; the tool surfaces those in the response.

### Why this is a 3.1.1 not a feature in 3.1.0
The 3.1.0 deferral attributed the upload failure to "Node 18's fetch + FormData + Blob produces a multipart body HC3 rejects with 500". That diagnosis was wrong. The actual blocker was an undocumented HC3 colorspace constraint:

- HC3 5.x's PNG icon validator silent-500s on non-palette PNGs. **Color type must be 3 (8-bit colormap with PLTE chunk).** RGB (color type 2) and RGBA (color type 6) are both rejected with HTTP 500 and an empty body — no useful error text.
- This was masked because curl-F was used to upload PNGs that happened to be palette-mode in earlier successful tests, and RGB-mode in the tests that failed. The Node multipart construction was fine all along.

### Validation added at the tool boundary
`upload_icon` now pre-checks PNG bytes: PNG signature, exact 128×128 dimensions, color type 3. Mismatches throw before the HC3 call with conversion hints (`magick -dither None -colors 256 -define png:color-type=3` or `pngquant`). Saves a confusing 500 from HC3.

### Skill catalogue corrections (additive to the 3.1.0 list)
- PNG color type: HC3 requires palette (type 3). RGB and RGBA produce silent 500s. The skill is silent on this; worth contributing.

## [3.1.0] - 2026-04-26

### Added
- `list_icons` — wraps `GET /api/icons`. Returns the three-bucket metadata `{device, room, scene}` (1012 entries on a populated install).
- `get_icon` — fetches an icon's binary content, base64-encoded. Resolves to `/assets/icon/fibaro/{rooms|scena|...}/<name>.<ext>` for built-ins or `/assets/userIcons/...` when `userIcon: true`. Detects HC3's silent fallback behaviour: if a `.png` is requested but HC3 returns `image/svg+xml`, that's the firmware's 1.9 KB "unknown icon" SVG substituted for a missing asset, and the tool throws rather than handing the caller HTML/SVG bytes labelled as a PNG. Returns `{name, extension, mime, sizeBytes, base64}`.
- `delete_icon` — wraps `DELETE /api/icons` with the correct shape: query params `type`, `id`, `name`, `fileExtension` (NOT a JSON body, NOT `type=custom` — both wrong in the skill docs and the official Fibaro reference). Resolves `id` automatically from `list_icons` if not supplied. Built-in icons cannot be deleted (HC3 returns 403); the tool surfaces that.

### Deferred
- `upload_icon` — wraps `POST /api/icons` with multipart/form-data. End-to-end research done (HC3 expects fields `type`/`icon`/`fileExtension`, requires PNGs to be exactly 128×128, ignores caller-supplied name and auto-assigns `User<N>`), but Node 18's built-in `fetch` + `FormData` + `Blob` produces a multipart body HC3 rejects with HTTP 500 — even when the same byte-level shape via `curl -F` works. Manual buffer construction with explicit boundary also rejected. Rather than ship a tool that doesn't work, deferred pending either a tcpdump comparison of the curl vs. fetch request bytes or adding a `form-data` npm dependency. For now, image upload is a manual `curl -F` step until this is resolved.

### Skill catalogue corrections (worth contributing back)
- `POST /api/icons` body shape: skill documents `{name, content: "data:..."}` JSON; correct shape is multipart/form-data with `type`, `icon` (file), `fileExtension`. HC3 ignores any caller-supplied name and auto-assigns `User<N>`.
- `DELETE /api/icons` body shape: skill documents `{type: "custom", name, fileExtension}` JSON; correct shape is query parameters `type` (room|scene|device, NOT "custom"), `id` (required, omitted from skill), `name`, `fileExtension`.
- PNG icon dimensions: skill silent on this; HC3 5.x rejects all sizes other than 128×128 with `400 INVALID_ICON_SIZE` for room/scene/device PNG icons.

## [3.0.1] - 2026-04-25

### Changed
- Contact address unified: `package.json` `author.email` and `SECURITY.md` vulnerability-report address both moved to `dev@cheetham.org` — a per-project inbox separate from the maintainer's personal and consulting-business addresses. No code change.

## [3.0.0] - 2026-04-25

Major version bump to reflect a deliberate identity change: the package was originally a VS Code extension scaffold with the MCP server as a sub-component. Everything VS Code-specific has been removed; what's published is now a clean standalone Node MCP server.

### Removed (breaking — for VS Code-extension users only)
- All VS Code extension entry points: `src/extension.ts`, `src/mcp/mcpServerProvider.ts`, the `src/test/` extension test harness.
- VS Code-specific files: `.vscode-test.mjs`, `.vscodeignore`, `vsc-extension-quickstart.md`, the `create-icon*.js` icon generators, `copilot-settings-example.json` (which hardcoded the upstream author's local dev path).
- `package.json` VS Code marketplace metadata: `displayName`, `publisher`, `galleryBanner`, `categories`, `activationEvents`, `contributes` (commands + configuration + mcpServerDefinitionProviders), `engines.vscode`, the `vscode:prepublish` script, the `pretest` script.
- VS Code-specific devDependencies: `@types/vscode`, `@vscode/test-cli`, `@vscode/test-electron`, `canvas`, `@types/mocha`. Lint dependencies preserved.

The package was never published to the VS Code marketplace, so the practical user impact is zero. Anyone who installed it as a VS Code extension via local development will need to switch to the standalone-server pattern documented in the rewritten README.

### Changed
- README rewritten around the standalone-server model: leads with `npm install` / `npx`, then env-var config, then per-MCP-client wiring (Claude Desktop, Claude Code, Cursor / Cline / Continue), then a collapsed tools list. The "Why this fork" section makes the differences vs. upstream and vs. the unscoped `mcp-server-hc3` package explicit.
- `keywords` expanded with terms users actually search (`claude`, `claude-desktop`, `cursor`, `cline`, `z-wave`, `quickapp`, `lua`).
- `test` script replaced with a no-op placeholder (the previous `vscode-test` runner doesn't apply outside the extension harness).

### Preserved
- Tool surface and behaviour. All 125+ tools, all guardrails, all post-write verifies. No code change in `src/mcp/hc3-mcp-server.ts`.
- Package name `@northernrough/hc3-mcp-server`.
- Credentials model (env vars only).
- Output path `./out/mcp/hc3-mcp-server.js` — kept rather than renaming to `./dist/index.js` (cosmetic-only churn).

## [2.16.2] - 2026-04-24

### Changed
- Pre-publish housekeeping: added a Security section and Maintenance section to README, added SECURITY.md describing the trust model, supported versions, vulnerability reporting (email), and the in/out-of-scope split. Added a fork-modifications copyright line to LICENSE alongside the existing GsonSoft Development line. SECURITY.md added to the npm `files` whitelist so it ships with the tarball. No code change.

## [2.16.1] - 2026-04-24

### Fixed
- `restart_quickapp` was POSTing to `/api/quickApp/{id}/restart` (no body), which HC3 5.x rejects with `400 JSON_PARSE_ERROR: "invalid JSON"` on the empty body and then with `map::at` even when an empty `{}` is supplied — the path itself doesn't exist on this firmware. The HC3 UI restarts QAs via the same `/api/plugins/restart` endpoint that `restart_plugin` already uses. Routed `restart_quickapp` through that endpoint with `{deviceId}` body. Two tools, one endpoint, parameter naming preserved for callers.

## [2.16.0] - 2026-04-24

Bundled release for five FRs addressing per-item CRUD gaps across custom events, scenes, device properties, delayed actions, and notifications.

### Added
- `get_device_property` (FR3) — single-property read via GET /api/devices/{id}/properties/{propertyName}. Returns `{value, modified}` — dramatically smaller than hydrating the full device record for scalar reads like `batteryLevel` or `value`.
- `cancel_delayed_action` (FR4) — DELETE /api/devices/action/{timestamp}/{deviceId}. Cancels a device action queued via the `delay` arg of a prior `control_device` call. Timestamp is truncated to integer seconds.
- `get_custom_event` / `update_custom_event` / `delete_custom_event` (FR1) — per-item custom event CRUD. `update_custom_event` supports rename via `newName` with post-write refetch under the new name. `delete_custom_event` captures `userDescription` as a recovery trail.
- `create_scene` (FR2) — POST /api/scenes. Pre-validates name length (1–50 chars) and type (lua/scenario). Sets HC3-required field defaults (mode="automatic", categories=[1], restart/protectedByPin/stopOnAlarm) that HC3's POST endpoint demands but are often omitted from docs; `roomId` required because HC3 rejects `roomId=0` on creation. Post-create verifies name + type.
- `get_notification` / `update_notification` / `delete_notification` (FR5 partial) — per-item notification center operations. `delete_notification` refuses entries where `canBeDeleted=false` unless `allow_system=true`; captures `{type, data}` as recovery trail.

### Deferred
- `create_notification` (FR5 completion) — HC3 rejects the documented type strings (`GenericSystemNotification`, `GenericSystemNotificationRequest`) with 500 and 400 respectively across several body shapes. Accepted shape is not derivable from the UI bundle or the skill docs. Pulled from this release rather than ship something that doesn't work; will return with a targeted probe in a follow-up.

## [2.15.0] - 2026-04-24

### Added
- Profile CRUD and association PUTs — rounds out the profile family (the earlier 2.10.0 shipped read + activate + modify; this adds the rest):
  - `create_profile` — POST /api/profiles with post-create verify
  - `delete_profile` — DELETE /api/profiles/{id}. Refuses if the target is the active profile; post-delete verify expecting 404
  - `reset_profiles` — DESTRUCTIVE: resets every profile to HC3 defaults. Requires explicit `confirm: true`; otherwise refuses with a clear warning
  - `set_profile_scene_action` — PUT /api/profiles/{pid}/scenes/{sid} with body `{actions: [...]}` and post-write verify against the profile's scenes array
  - `set_profile_climate_zone_action` — PUT /api/profiles/{pid}/climateZones/{czid} with body `{mode, properties}` and post-write verify
  - `set_profile_partition_action` — PUT /api/profiles/{pid}/partitions/{pid} with body `{action}` and post-write verify

Body shapes inferred from the HC3 UI bundle (read-only reverse-engineering) and the stored shape of existing profiles on live HC3 — no raw-curl write probing.

## [2.14.0] - 2026-04-24

### Added
- `create_global_variable` — pair for `delete_global_variable`. Wraps `POST /api/globalVariables`. Refuses to overwrite an existing variable (use `set_global_variable` to update). Pre-validates name against HC3's required regex `[A-Za-z][A-Za-z0-9_]*`. Supports isEnum globals with `enumValues`; validates initial value against the enum (case-sensitive) before POSTing. Post-create verify by refetch + stringified-value compare.

## [2.13.0] - 2026-04-24

### Added
- `get_refresh_states` — HC3's native event/state-change stream via `GET /api/refreshStates?last={cursor}`. Returns `changes` (device-state snapshot on first call, just deltas on subsequent calls) + `events` (discrete events: scene starts, device actions, central-scene button presses, etc.) + new `last` cursor to pass to the next call. This is what HC3 QuickApps use under the hood for refreshStates event subscriptions. Caller tracks the cursor — stateless on the tool side. First call returns a ~1 MB snapshot (980 change entries on a 1000-device install); subsequent incremental calls are small. Complementary to `get_event_history`: refreshStates is live poll, event_history is retrospective query.

## [2.12.0] - 2026-04-24

### Added
- `filter_devices` — server-side multi-criteria device filter via `POST /api/devices/filter`. Richer than `get_devices`' query-string filters: supports multiple ANDed predicates and projects only requested attributes (huge token-saving on a 1000-device HC3). Accepts `filters: [{filter, value[]}]` and `attributes: [...]`. Common filter keys: `deviceID`, `enabled`, `visible`, `roomID`, `parentId`, `deviceState`, `type`, `baseType`, `interface`, `isPlugin`, `hasProperty`, `hasNoProperty`.

## [2.11.0] - 2026-04-24

### Added
- Room CRUD + batch assignment — five tools filling the rooms write gap:
  - `get_room` — single room by id
  - `create_room` — POST /api/rooms. Pre-validates name length ≤ 20 chars because HC3 silently truncates longer names (empirically caught on live test). Post-create verify.
  - `modify_room` — PUT /api/rooms/{id} with read-modify-write + verifyWrite on submitted fields.
  - `delete_room` — DELETE with two guards: refuses the default room (`isDefault: true`); refuses rooms with devices unless `reassign_to` (target roomId) is supplied to batch-move first.
  - `assign_devices_to_room` — POST /api/rooms/{id}/groupAssignment for batch moves. Post-move verifies each device's `roomID` matches.

## [2.10.0] - 2026-04-24

### Added
- Profile management — four tools covering the practical Home/Away/Vacation orchestration workflow, wrapping the `/api/profiles` surface:
  - `get_profiles` — list profiles + activeProfile id
  - `get_profile` — one profile's devices/scenes/climateZones/partitions detail
  - `activate_profile` — switch active profile, with post-activation refetch verify
  - `modify_profile` — read-modify-write + verifyWrite on a partial fields update (name, iconId, devices, scenes, climateZones, partitions)

Profile CRUD (`create_profile`, `delete_profile`), `reset_profiles`, and per-child-entity PUTs (`/profiles/{id}/scenes/{sid}` etc.) intentionally skipped for now as edge cases; the four shipped cover the practical orchestration workflow.

## [2.9.0] - 2026-04-24

### Added
- `run_scene_sync` — synchronous scene execution via `POST /api/scenes/{id}/executeSync`. Unlike `run_scene` (fires async and returns immediately), this waits for the scene to finish before returning. Useful for sequencing dependent automation steps. Returns `{sceneId, mode: 'sync', elapsedMs}`.
- `clear_debug_messages` — `DELETE /api/debugMessages`. Reads the current count first and returns `{cleared: N}` so the caller knows how many were dropped. Useful for test loops — clear before a scene/QA action, then `get_debug_messages` to see only the fresh logs.

## [2.8.0] - 2026-04-24

### Added
- `delete_device` — per-device deletion by id via DELETE /api/devices/{id}. Guards: refuses ids < 10 (system-reserved); refuses Z-Wave physical devices unless `allow_physical=true` (REST delete skips mesh exclusion and leaves a ghost node on the controller); refuses devices with children unless `cascade=true` (rejection includes child count + first 10 names so the blast radius is visible). Post-delete verified by refetch expecting 404. Returns `{deleted, name, type, wasQuickApp, wasPlugin, childrenRemovedWith}`.
- `delete_global_variable` — global-variable deletion by name via DELETE /api/globalVariables/{name}. Reads the variable first to capture `lastValue` (returned in the response as a recovery trail) and the readOnly / isEnum flags. Refuses readOnly system globals unless `allow_system=true`. Post-delete verified by refetch expecting 404.

### Changed
- `delete_plugin` semantics clarified (non-breaking): description now makes plain this is a BULK uninstall of every device of a given plugin type, and directs callers to the new `delete_device` for per-device removal. Added a safety guard — when more than one device of the type exists, the tool refuses unless `allow_bulk=true`. Guard caught a real risk on a live HC3: `type: com.fibaro.genericDevice` would uninstall three unrelated user QAs at once; old unguarded behaviour would silently wipe them.

## [2.7.0] - 2026-04-23

### Added
- `snapshot` — single-call dump of every mutable HC3 configuration surface for backup regimes and drift detection. Read-only. Per-surface atomicity via `Promise.allSettled`: one failing surface doesn't abort others; failures land in `surfaceErrors`. Default set (`devices`, `rooms`, `scenes`, `quickapps` with per-file content, `globals`, `custom-events`, `alarm`, `climate`, `system`, `users`, `hc3-docs`) runs in ~1s on a household HC3 (1006 devices, 20 QAs, 36 QA files). Opt-in surface `zwave-parameters` iterates per-Z-Wave-device with `concurrency=8`; ~3s for 185 devices / 3141 params on this firmware. Include-list and exclude-list filters; unknown surface names silently dropped. Returns `{capturedAt, elapsedMs, surfaces, surfaceErrors, includeResolved}`. Motivated by the 2026-04-23 user-rights incident where recovery required scavenging state from a Claude Code transcript — a routine snapshot regime would have prevented the scramble.

## [2.6.0] - 2026-04-23

### Added
- `update_user_rights` — write counterpart to `get_users` for modifying a user's access rights (`devices` / `scenes` / `climateZones` / `profiles` / `alarmPartitions`). Follows the standard read-modify-write + post-write-verify pattern: reads current user, deep-merges the submitted `rights.*` subkeys onto current, full-array-replaces leaf arrays (matching HC3 PUT semantics). Post-write refetch verifies every submitted array member is present; mismatches throw. **Send-shape detail:** PUTs only `{rights: merged}` rather than the full user record — HC3 rejects full-record echo-back with `403 "Terms of service acceptance change forbidden"` because admin users cannot toggle another user's `tosAccepted` / `privacyPolicyAccepted` flags. Completes the bundle alongside `find_devices_by_name` / `find_device_by_endpoint` for manifest-driven user-rights sync resilient to Z-Wave re-inclusion.
- Safety guards: rejects `rights.advanced.*` writes unless `allow_advanced_rights=true` (17 sensitive subkeys including `zWave`/`backup`/`access`/`update` — privilege-escalation footgun); rejects `rights.<category>.all=true` mass-grants unless `allow_grant_all=true`; rejects writes targeting `type: "superuser"` users outright.

## [2.5.0] - 2026-04-23

### Added
- `find_device_by_endpoint` — resolve a multi-endpoint child device by its `(parentId, endpointId)` pair. Stable identity for children that survives Z-Wave re-inclusion: `parentId` is resolved via the parent's (stable) name, `endPointId` is the Z-Wave endpoint number which never shifts. Pairs with `find_devices_by_name`. Returns an ARRAY of matches (not single + null) because endpoint 0 is commonly ambiguous: multi-endpoint parents expose multiple child roles at endpoint 0 (e.g. a ZEN52 wrapper has both a binarySwitch and a remoteController at endpoint 0; an AEON MultiSensor has motion/temp/lux/humidity siblings there). Non-zero endpoints are usually unique. Building block — together with `find_devices_by_name` — for manifest-driven sync that survives Z-Wave re-inclusion.

## [2.4.1] - 2026-04-23

### Fixed
- `find_devices_by_name` top-level filter broadened from `parentId === 0` to `parentId in {0, 1}`. On HC3 the physical Z-Wave device nodes are children of the Z-Wave root controller (device id 1), not `parentId==0`, so the original filter missed 187 of the 252 genuinely top-level devices on a typical household install (all the blinds, Walli switches, single-node sensors). 2.4.0 returned empty for most real-world name searches. Known follow-up (not in this patch): multi-sensor children whose parent is a Z-Wave node (e.g. AEON MultiSensor 6 — the "right nite motion" child is at `parentId=<node>`, `endPointId=0`, distinguished from its "right nite temp" and "right nite lux" siblings by `type` rather than endpoint) — still not findable via this tool; would need a separate `find_child_by_type(parentId, type)` or equivalent.

## [2.4.0] - 2026-04-23

### Added
- `find_devices_by_name` — resolve a human-readable device name to one or more HC3 devices without pulling the full `/api/devices` payload (~4 MB on a 1000-device install). Case-insensitive substring match by default, `exactMatch` opt-in, optional `roomId` narrowing and `visibleOnly` flag. Filters to parent/top-level devices only (`parentId === 0`) — child endpoints of multi-endpoint Z-Wave devices and child QAs are excluded; a separate sibling tool will handle child-endpoint resolution. HC3 has no native name filter on `/api/devices` (the documented `?property=...&value=...` filter only applies to `properties.*` fields, not top-level `name`), so this filters in-process. Returns minimal `{id, name, roomID, type, visible, enabled, dead}` records. Building block for manifest-driven name→id resolution that survives Z-Wave re-inclusion.

## [2.3.0] - 2026-04-23

Gap-filling release after an audit of HC3's authoritative OpenAPI specs at `/assets/docs/hc/plugins.json` and `/assets/docs/hc/quickapp.json` (not linked from the public Swagger UI — credit jgab for surfacing them).

### Added
- `create_quickapp` — create a brand-new empty QuickApp on HC3 from scratch (as opposed to `import_quickapp`, which loads a .fqa). Wraps `POST /api/quickApp`. Accepts `name`, `type`, optional `roomId` / `initialProperties` / `initialInterfaces` / `initialView`. Returns the HC3-assigned `deviceId` and the created device; post-create verified by refetching and confirming name + type match.
- `get_quickapp_available_types` — list the QuickApp device types this firmware knows about. Returns 32 `{type, label}` pairs on HC3 5.202.54. Use as the authoritative list when picking `type` for `create_quickapp` or validating plua `--%%type=...` headers. Wraps `GET /api/quickApp/availableTypes`.

### Changed
- `export_quickapp` description tightened to explain what encrypted export actually does: produces a .fqax locked to a list of HC3 serial numbers that are the only controllers permitted to import it. Useful for distributing a QA to specific third-party HC3 units without allowing further redistribution. No behaviour change.

## [2.2.2] - 2026-04-22

### Changed
- `modify_device` reject message for `properties.parameters` now (a) softens the "does not transmit" claim to match what we actually observed (in direct testing against a Zooz ZEN52 the cache updated, HC3 reported success, and the physical device's behaviour did not change — but HC3 5.x has no working REST path to verify whether any given write transmitted, so "does not reliably transmit" is the defensible claim, not "never transmits"), and (b) points callers at `get_device_parameters(deviceId)` for inspecting HC3's stored parameter values, labels, and formats without opening the Web UI.

## [2.2.1] - 2026-04-22

### Fixed
- `get_device_parameters` provenance wording was too pessimistic. Empirical check on an FGD212 dimmer showed multiple parameters whose values **differ** from their template `defaultValue` yet still carry `source: "template"` — so `"template"` does not mean "catalogue default returned as a placeholder" (the earlier framing). It means the value is from HC3's template-backed storage layer: what HC3 recorded the device as being configured to when the HC3 UI's native Z-Wave path wrote to it. In normal operation these values match the physical device; HC3 5.x just can't re-verify them over REST on demand. Revised the tool's description, the response `provenance_note` field, and renamed the response flag `all_values_are_template_defaults` → `all_values_are_hc3_stored` so callers know what the data actually is: "HC3's best knowledge of the device's configuration, almost certainly correct, not programmatically re-provable".

## [2.2.0] - 2026-04-22

### Added
- `get_device_parameters` — read a Z-Wave device's configuration parameters with human-readable labels and descriptions, sourced by merging `/api/zwave/configuration_parameters/{addr}` (current values) and `/api/zwave/parameters_templates/{addr}` (template catalogue). Returns per parameter: number, value, size, source provenance, label, description, default value, format. Honest about the HC3 5.x mesh-read limitation: every parameter carries a `source` field passed through verbatim from HC3; on current firmware the value is almost always `"template"` (catalogue default, not a physical-device read-back) because the mesh read-back path (`getParameter`, `reconfigure`, `pollConfigurationParameter`) is not-implemented or no-ops silently. A top-level `all_values_are_template_defaults` boolean flags when every returned value carries `source: "template"`, and a `provenance_warning` string explains what to trust. Live-tested against AEON MultiSensor 6, FGD212 Dimmer, and Zooz ZEN52. Parameter writes remain scoped out — `modify_device` still rejects `properties.parameters` per S14. Sources undocumented endpoints under `/api/zwave/*`.

## [2.1.1] - 2026-04-22

Bug-fix release covering two regressions surfaced immediately after the 2.1.0 tag was cut.

### Fixed
- `run_scene` / `stop_scene` were calling `/api/scenes/{id}/action/start` and `/action/stop`, which HC3 5.x rejects with `400 JSON_PARSE_ERROR: "The document is empty"`. The correct endpoints are `/api/scenes/{id}/execute` and `/api/scenes/{id}/kill` with a `{}` body. Both tools now use the correct paths.
- `set_global_variable` now reads the variable's current shape before writing and coerces the submitted value to match. Previously a boolean `true` on a string-valued global (e.g. the `isEnum` variable `isDark` with values `["false","true"]`) hit HC3's `deserializeJson error: types mismatch`. For `isEnum` globals the tool rejects values outside `enumValues` at the tool boundary (case-sensitive, matching HC3 semantics); for non-enum globals the submitted value is coerced to the current value's JS type. Read-only system globals are rejected before the PUT, and the write is now post-write-verified.

## [2.1.0] - 2026-04-21

Additive release: four new diagnostic tools, hardened write paths, and safety fixes found by live probing against HC3 5.x. No breaking changes.

### Added
- `get_zwave_mesh_health` — aggregate mesh health from `/api/devices?interface=zwave`: dead/unconfigured counts, dead devices with node IDs and reasons, breakdowns by room and manufacturer. Documented endpoint.
- `get_zwave_node_diagnostics` — per-node Z-wave transmission counters (frame totals, outgoing failures, incoming CRC/S0/S2/TransportService/MultiChannel failure breakdown, nonce exchanges). Enriched with device name, room, and computed `outgoingFailedPercent`; optional `min_outgoing_failed_percent` and `sort_by` filters. Sources the undocumented `/api/zwave/nodes/diagnostics/transmissions` (read-only).
- `get_zwave_reconfiguration_tasks` — active Z-wave reconfiguration tasks with status, target device and node, soft-vs-full flag, and child-device summary. Sources the undocumented `/api/zwaveReconfigurationTasks` (read-only).
- `get_event_history` — HC3 system event feed (scene starts, device property changes, device actions) — the data behind `/app/history`. Supports `limit` (capped at 1000 to prevent HC3 timeouts), `event_type` (case-sensitive exact match), `object_id` + `object_type`, and `since_timestamp` (filtered client-side because HC3 silently ignores the server-side `timestamp` param).

### Fixed
- **Write-path verification gaps** closed on every non-trivial mutating tool that was previously PUT-without-compare:
  - `modify_scene` now calls `verifyWrite` on the refetched scene — a silently-dropped field (like the class seen on Z-wave `properties.parameters`) no longer reports success.
  - `update_quickapp_file` refetches and byte-compares content after PUT.
  - `update_multiple_quickapp_files` does parallel per-file refetches (the `/files` list endpoint omits content; individual GETs required) and per-file content compare. Partial bulk-write failures now surface.
  - `create_quickapp_file` refetches by name after POST and verifies presence + content match.
  - `set_home_status` adds a runtime enum guard (`Home`/`Away`/`Night`/`Vacation`) — the schema advertised the enum but the handler trusted the caller.
  - `set_global_variable` URL-encodes `varName` path segment for consistency with every other user-supplied path component.
- `modify_device` now rejects `properties.parameters`, `properties.associations`, and `properties.multichannelAssociations` at the tool boundary. HC3 5.x caches these values and reports success but does not transmit them over the Z-wave mesh, producing a misleading "updated" state — the physical device keeps behaving on the old configuration. Matches the dedicated `getParameter`/`setParameter` action endpoints, which return "not implemented" on this firmware.
- `makeApiRequest` now throws when HC3 returns the JSON-RPC failure envelope (`{jsonrpc, error: {code, message}}`) on an HTTP 2xx action POST. Previously failures like "not implemented" passed through as success. Affects every action-POST path (devices, scenes, alarms, sprinklers, plugins).
- `control_device` pre-checks the requested action against `device.actions` and rejects unknown actions with the valid-action list. HC3 returns HTTP 404 for unknown actions on Z-wave devices but silently accepts anything on a QuickApp (actions route to the Lua `onAction` handler which dead-drops if unhandled). Soft-skips the check when `actions` is empty so QAs with dynamic action handling still pass through.
- `get_event_history` no longer claims to filter by `since_timestamp` server-side (HC3 silently ignores the timestamp query param) — filter is now applied client-side after fetch.
- `get_event_history` caps `limit` at 1000 client-side. HC3 has no server-side cap; a naive `limit=100000` used to time the MCP request out.
- URL-encode defensive fixes on `control_device` action name and `call_ui_event` event type, matching the pattern already in place on every other user-supplied path segment.
- Composite read tools (`get_system_context`, `get_device_relationships`, `get_automation_suggestions`, `explain_device_capabilities`) no longer swallow HC3 errors on their primary fetches. Ancillary fetches (weather, info) still go through a tolerant helper.
- Read-tool schemas no longer advertise `interval` / `includeExamples` flags that their handlers ignored.

## [2.0.0] - 2026-04-19

This is the first release from the [northernRough/HC3_mcp](https://github.com/northernRough/HC3_mcp) fork, which is now the actively maintained line. The upstream author moved to a different QuickApp development workflow (skills + plua) and greenlit the fork. Thanks to [jgab](https://github.com/jangabrielsson) for the original implementation.

### Breaking changes
- `update_climate_zone` parameter shape: `settings: any` replaced with `topLevel` / `properties` split. Callers must migrate.
- `update_location_settings` parameter shape: `settings: any` replaced with `locationId` + `fields` pair. Callers must migrate.
- `control_device` now rejects `action: "setVariable"` at the tool boundary. Callers must use `set_quickapp_variable` instead (type-aware, verified PUT). Prevents silent corruption of string-typed QuickApp variables.
- `modify_device` now rejects `properties.quickAppVariables` submissions. Callers must use `set_quickapp_variable` for QuickApp variable writes. Prevents silent wipe of unsubmitted variables.
- Tools removed as broken or fabricated: `get_quickapp_logs` (endpoint doesn't exist), `get_device_usage_patterns` (returned `Math.random()` output).

### Added
- `modify_scene` — update scene top-level metadata (name, icon, roomId, etc.).
- `update_scene_content` — replace Lua actions/conditions on a scene.
- `get_quickapp_variable` / `set_quickapp_variable` — single-variable read/write with declared-type coercion and verified PUT.
- Client-side filtering on `get_debug_messages` (tagContains, since, type, summary object).

### Fixed
- **Write guardrails** on every non-trivial write tool: read-modify-write semantics, post-write verification via refetch + field-by-field comparison, clear mismatch errors instead of silent "updated successfully".
  - `modify_device`: topLevel/properties split, rejects `quickAppVariables`, verifies writes.
  - `update_climate_zone`: topLevel/properties split, read-modify-write deep-merge on nested schedule objects, verifies writes. Prevents partial submissions wiping weekly schedules, device lists, or temperature sensors.
  - `update_location_settings`: locationId/fields, read-modify-write, verifies writes. Rejects read-only fields (`id`, `created`, `modified`).
  - `update_multiple_quickapp_files`: preserves `isMain` flag per file instead of hardcoding `false`.
- Shared `deepEqual`, `deepMerge`, `verifyWrite` helpers extracted for consistent write-path behaviour.
- Numerous camelCase vs snake_case mismatches between tool schemas and handlers, including fixes that made `explain_device_capabilities` and `get_device_relationships`'s `deviceId` filter actually work.
- `makeApiRequest` no longer crashes on empty response bodies (DELETE, restart, some PUTs).
- `makeApiRequest` 15-second timeout via `AbortSignal.timeout`.
- `makeApiRequest` surfaces HC3 error body detail instead of discarding it.
- MCP protocol version bumped to `"2024-11-05"`.
- `notifications/initialized` handled silently (no error response with undefined id).
- `ping`, `resources/list`, `prompts/list` handlers added (were returning "Method not found").
- `update_device_property` description now flags the endpoint as undocumented and points callers at `modify_device`.
- `axios` devDependency removed (never used).
- Accurate README tool list (83 tools grouped as the code organises them), correct tool count, CHANGELOG-linked release notes.
- Numerous lying schemas corrected (non-functional filter flags removed from tool schemas).

## [1.0.3] - 2025-08-19

### Fixed
- Fixed MCP server registration with GitHub Copilot after extension renaming
- Restored "*" activation event for proper early MCP server discovery
- Fixed TypeScript compilation errors in automation suggestions
- Updated provider ID to maintain compatibility

### Added
- New command "Configure GitHub Copilot MCP" for easier setup
- Enhanced debugging logs for MCP server resolution
- Documentation updates with troubleshooting notes

### Changed
- Improved README with session refresh instructions
- Updated MCP configuration guide with troubleshooting steps

## [1.0.2] - 2025-08-19

### Fixed
- Replaced placeholder icon with professional HC3-themed icon
- Improved performance by removing star activation warning

## [1.0.1] - 2025-08-19

### Fixed
- Added proper icon for VS Code marketplace

## [1.0.0] - 2025-08-19

### Added
- Initial release with 66+ MCP tools for Fibaro HC3 integration
- Complete REST API coverage for devices, scenes, variables, and system management
- QuickApp development tools with file manipulation capabilities
- Plugin management with UI interaction and lifecycle control
- Intelligent automation suggestions and device relationship analysis
- Built-in HC3 programming documentation and examples
- Support for both VS Code settings and environment variable configuration